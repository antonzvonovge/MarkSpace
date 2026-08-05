import { create } from "zustand";
import {
  loadGithubSync,
  normalizeAutoSyncMinutes,
  saveGithubToken,
  saveVaultSyncMeta,
  type AutoSyncMinutes,
} from "../lib/settingsStore";
import {
  getSyncStatus,
  syncConnect,
  syncDeviceFlowPoll,
  syncDeviceFlowStart,
  syncDisconnect,
  syncGithubClientId,
  syncNow,
  syncResolveConflict,
  type DeviceCodeResponse,
  type SyncStatus,
} from "../lib/syncApi";
import { useVaultStore } from "./vaultStore";

/** Keep vault-change quiet for the whole sync + FS settle. */
const SYNC_WATCH_SUPPRESS_MS = 120_000;
const SYNC_WATCH_SETTLE_MS = 2_500;

type SyncStore = {
  hydrated: boolean;
  token: string | null;
  clientIdAvailable: boolean;
  status: SyncStatus | null;
  remoteUrlInput: string;
  patInput: string;
  busy: boolean;
  message: string | null;
  error: string | null;
  deviceFlow: DeviceCodeResponse | null;
  lastSyncAt: string | null;
  autoSyncMinutes: AutoSyncMinutes;
  hydrate: () => Promise<void>;
  loadVaultMeta: (vaultPath: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  setRemoteUrlInput: (url: string) => void;
  setPatInput: (pat: string) => void;
  setAutoSyncMinutes: (
    vaultPath: string,
    minutes: AutoSyncMinutes,
  ) => Promise<void>;
  savePat: () => Promise<void>;
  clearToken: () => Promise<void>;
  connect: (vaultPath: string) => Promise<void>;
  disconnect: (vaultPath: string) => Promise<void>;
  runSync: (vaultPath: string, flushSave: () => Promise<void>) => Promise<void>;
  startDeviceFlow: () => Promise<void>;
  cancelDeviceFlow: () => void;
  resolveConflict: (
    path: string,
    choice: "ours" | "theirs" | "both",
  ) => Promise<void>;
};

const emptyStatus = (): SyncStatus => ({
  connected: false,
  isRepo: false,
  remoteUrl: null,
  branch: null,
  dirty: false,
  ahead: 0,
  behind: 0,
  conflicted: [],
  lastError: null,
});

export const useSyncStore = create<SyncStore>((set, get) => ({
  hydrated: false,
  token: null,
  clientIdAvailable: false,
  status: null,
  remoteUrlInput: "",
  patInput: "",
  busy: false,
  message: null,
  error: null,
  deviceFlow: null,
  lastSyncAt: null,
  autoSyncMinutes: 0,

  hydrate: async () => {
    const [cfg, clientId] = await Promise.all([
      loadGithubSync(),
      syncGithubClientId(),
    ]);
    set({
      hydrated: true,
      token: cfg.token,
      clientIdAvailable: Boolean(clientId),
      patInput: "",
    });
  },

  loadVaultMeta: async (vaultPath) => {
    const cfg = await loadGithubSync();
    const meta = cfg.byVault[vaultPath];
    set({
      lastSyncAt: meta?.lastSyncAt ?? null,
      autoSyncMinutes: normalizeAutoSyncMinutes(meta?.autoSyncMinutes),
      remoteUrlInput: meta?.remoteUrl ?? get().status?.remoteUrl ?? "",
    });
  },

  refreshStatus: async () => {
    try {
      const status = await getSyncStatus();
      const current = get().remoteUrlInput;
      set({
        status,
        error: status.lastError,
        ...(!current.trim() && status.remoteUrl
          ? { remoteUrlInput: status.remoteUrl }
          : {}),
      });
    } catch (e) {
      set({
        status: emptyStatus(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  setRemoteUrlInput: (url) => set({ remoteUrlInput: url }),
  setPatInput: (pat) => set({ patInput: pat }),

  setAutoSyncMinutes: async (vaultPath, minutes) => {
    const autoSyncMinutes = normalizeAutoSyncMinutes(minutes);
    set({ autoSyncMinutes });
    const cfg = await loadGithubSync();
    const existing = cfg.byVault[vaultPath];
    const remoteUrl =
      existing?.remoteUrl ??
      get().status?.remoteUrl ??
      get().remoteUrlInput.trim();
    if (!remoteUrl) {
      set({ message: "Connect a repository before enabling auto-sync" });
      return;
    }
    await saveVaultSyncMeta(vaultPath, {
      remoteUrl,
      lastSyncAt: existing?.lastSyncAt ?? get().lastSyncAt,
      autoSyncMinutes,
    });
    set({
      message:
        autoSyncMinutes === 0
          ? "Auto-sync off"
          : `Auto-sync every ${autoSyncMinutes} min`,
      error: null,
    });
  },

  savePat: async () => {
    const pat = get().patInput.trim();
    if (!pat) {
      set({ error: "Paste a Personal Access Token first" });
      return;
    }
    await saveGithubToken(pat);
    set({ token: pat, patInput: "", message: "Token saved", error: null });
  },

  clearToken: async () => {
    await saveGithubToken(null);
    set({ token: null, patInput: "", message: "Signed out", error: null });
  },

  connect: async (vaultPath) => {
    const url = get().remoteUrlInput.trim();
    if (!url) {
      set({ error: "Enter a repository URL or owner/repo" });
      return;
    }
    set({ busy: true, error: null, message: null });
    try {
      const status = await syncConnect(url, get().token);
      const cfg = await loadGithubSync();
      const prev = cfg.byVault[vaultPath];
      const autoSyncMinutes = normalizeAutoSyncMinutes(
        prev?.autoSyncMinutes ?? get().autoSyncMinutes,
      );
      await saveVaultSyncMeta(vaultPath, {
        remoteUrl: status.remoteUrl ?? url,
        lastSyncAt: prev?.lastSyncAt ?? null,
        autoSyncMinutes,
      });
      set({
        status,
        remoteUrlInput: status.remoteUrl ?? url,
        autoSyncMinutes,
        message: status.connected ? "Connected" : "Remote set",
        error: status.lastError,
        busy: false,
      });
    } catch (e) {
      set({
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  disconnect: async (vaultPath) => {
    set({ busy: true, error: null, message: null });
    try {
      const status = await syncDisconnect();
      await saveVaultSyncMeta(vaultPath, null);
      set({
        status,
        remoteUrlInput: "",
        lastSyncAt: null,
        autoSyncMinutes: 0,
        message: "Disconnected",
        busy: false,
      });
    } catch (e) {
      set({
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  runSync: async (vaultPath, flushSave) => {
    set({ busy: true, error: null, message: null });
    useVaultStore.getState().markExternalWrite(SYNC_WATCH_SUPPRESS_MS);
    try {
      await flushSave();
      const result = await syncNow(get().token);
      const lastSyncAt =
        result.conflicted.length === 0
          ? new Date().toISOString()
          : get().lastSyncAt;
      if (result.status.remoteUrl && result.conflicted.length === 0) {
        await saveVaultSyncMeta(vaultPath, {
          remoteUrl: result.status.remoteUrl,
          lastSyncAt,
          autoSyncMinutes: get().autoSyncMinutes,
        });
      }
      set({
        status: result.status,
        message: result.message,
        error: result.conflicted.length
          ? "Resolve conflicts, then sync again"
          : result.status.lastError,
        lastSyncAt,
        busy: false,
      });
    } catch (e) {
      set({
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      useVaultStore.getState().markExternalWrite(SYNC_WATCH_SETTLE_MS);
    }
  },

  startDeviceFlow: async () => {
    set({ busy: true, error: null, message: null, deviceFlow: null });
    try {
      const flow = await syncDeviceFlowStart();
      set({ deviceFlow: flow, busy: false });

      const started = Date.now();
      const poll = async () => {
        const current = get().deviceFlow;
        if (!current || current.deviceCode !== flow.deviceCode) return;
        if (Date.now() - started > flow.expiresIn * 1000) {
          set({
            deviceFlow: null,
            error: "Device login expired — try again",
          });
          return;
        }
        try {
          const res = await syncDeviceFlowPoll(flow.deviceCode);
          if (res.accessToken) {
            await saveGithubToken(res.accessToken);
            set({
              token: res.accessToken,
              deviceFlow: null,
              message: "Signed in with GitHub",
              error: null,
            });
            return;
          }
          if (res.error === "authorization_pending" || res.error === "slow_down") {
            const delay =
              (res.error === "slow_down" ? flow.interval + 5 : flow.interval) *
              1000;
            window.setTimeout(() => void poll(), delay);
            return;
          }
          if (res.error === "expired_token") {
            set({
              deviceFlow: null,
              error: "Device login expired — try again",
            });
            return;
          }
          if (res.error) {
            set({
              deviceFlow: null,
              error: res.errorDescription ?? res.error,
            });
            return;
          }
          window.setTimeout(() => void poll(), flow.interval * 1000);
        } catch (e) {
          set({
            deviceFlow: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      };
      window.setTimeout(() => void poll(), flow.interval * 1000);
    } catch (e) {
      set({
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  cancelDeviceFlow: () => set({ deviceFlow: null }),

  resolveConflict: async (path, choice) => {
    set({ busy: true, error: null });
    useVaultStore.getState().markExternalWrite(SYNC_WATCH_SUPPRESS_MS);
    try {
      const status = await syncResolveConflict(path, choice);
      set({
        status,
        busy: false,
        message:
          status.conflicted.length === 0
            ? "Conflict resolved"
            : "Conflict updated — more remain",
      });
    } catch (e) {
      set({
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      useVaultStore.getState().markExternalWrite(SYNC_WATCH_SETTLE_MS);
    }
  },
}));
