import { useEffect, useRef } from "react";
import { useSyncStore } from "../store/syncStore";
import { useVaultStore } from "../store/vaultStore";

/**
 * Periodic + on-focus auto-sync for the open vault.
 * Interval comes from vault-specific `autoSyncMinutes` (0 = off).
 */
export function useAutoSync() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const saveActive = useVaultStore((s) => s.saveActive);
  const markExternalWrite = useVaultStore((s) => s.markExternalWrite);
  const refreshTree = useVaultStore((s) => s.refreshTree);

  const autoSyncMinutes = useSyncStore((s) => s.autoSyncMinutes);
  const status = useSyncStore((s) => s.status);
  const busy = useSyncStore((s) => s.busy);
  const runSync = useSyncStore((s) => s.runSync);
  const refreshStatus = useSyncStore((s) => s.refreshStatus);
  const loadVaultMeta = useSyncStore((s) => s.loadVaultMeta);

  const lastAttemptRef = useRef(0);

  useEffect(() => {
    if (!vaultPath) return;
    void loadVaultMeta(vaultPath);
  }, [vaultPath, loadVaultMeta]);

  useEffect(() => {
    if (!vaultPath || autoSyncMinutes <= 0) return;

    const trySync = async (reason: "interval" | "focus") => {
      const state = useSyncStore.getState();
      if (state.busy) return;
      if (!state.status?.connected) return;
      if ((state.status.conflicted?.length ?? 0) > 0) return;

      const now = Date.now();
      // Avoid thrashing on rapid focus events
      if (reason === "focus" && now - lastAttemptRef.current < 60_000) return;
      lastAttemptRef.current = now;

      await runSync(vaultPath, async () => {
        await saveActive();
      });
      markExternalWrite();
      await refreshTree();
      await refreshStatus();
    };

    const intervalMs = autoSyncMinutes * 60_000;
    const timer = window.setInterval(() => {
      void trySync("interval");
    }, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void trySync("focus");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    vaultPath,
    autoSyncMinutes,
    status?.connected,
    busy,
    runSync,
    saveActive,
    markExternalWrite,
    refreshTree,
    refreshStatus,
  ]);
}
