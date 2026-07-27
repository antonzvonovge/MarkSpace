import { Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_PREFS,
  type EditorFontFamilyId,
  type Prefs,
} from "../settings/types";

const STORE_FILE = "settings.json";
const PREFS_KEY = "prefs";

function clampFontSize(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(28, Math.max(11, Math.round(n)));
}

function parseFontFamily(
  value: unknown,
  fallback: EditorFontFamilyId,
): EditorFontFamilyId {
  return value === "mono" || value === "sans" ? value : fallback;
}

type LegacyPrefs = Partial<Prefs> & {
  editorFontSize?: number;
  editorFontFamily?: EditorFontFamilyId;
};

function mergePrefs(raw: LegacyPrefs | null | undefined): Prefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };

  const legacySize =
    typeof raw.editorFontSize === "number" && Number.isFinite(raw.editorFontSize)
      ? Math.min(28, Math.max(11, Math.round(raw.editorFontSize)))
      : undefined;

  return {
    theme: raw.theme === "dark" || raw.theme === "light" ? raw.theme : DEFAULT_PREFS.theme,
    uiFontSize:
      typeof raw.uiFontSize === "number" && Number.isFinite(raw.uiFontSize)
        ? Math.min(20, Math.max(11, Math.round(raw.uiFontSize)))
        : DEFAULT_PREFS.uiFontSize,
    liveFontSize: clampFontSize(
      raw.liveFontSize ?? legacySize,
      DEFAULT_PREFS.liveFontSize,
    ),
    liveFontFamily: parseFontFamily(
      raw.liveFontFamily ?? raw.editorFontFamily,
      DEFAULT_PREFS.liveFontFamily,
    ),
    sourceFontSize: clampFontSize(
      raw.sourceFontSize ?? legacySize,
      DEFAULT_PREFS.sourceFontSize,
    ),
    sourceFontFamily: parseFontFamily(
      raw.sourceFontFamily ?? raw.editorFontFamily,
      DEFAULT_PREFS.sourceFontFamily,
    ),
    defaultViewMode:
      raw.defaultViewMode === "source" || raw.defaultViewMode === "live"
        ? raw.defaultViewMode
        : DEFAULT_PREFS.defaultViewMode,
  };
}

export async function loadPrefs(): Promise<Prefs> {
  const store = await Store.load(STORE_FILE);
  const raw = await store.get<LegacyPrefs>(PREFS_KEY);
  return mergePrefs(raw);
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  const store = await Store.load(STORE_FILE);
  await store.set(PREFS_KEY, prefs);
  await store.save();
}

export async function loadLastVault(): Promise<string | null> {
  const store = await Store.load(STORE_FILE);
  return (await store.get<string>("lastVault")) ?? null;
}

export async function saveLastVault(path: string): Promise<void> {
  const store = await Store.load(STORE_FILE);
  await store.set("lastVault", path);
  await store.save();
}

export async function loadExpandedPaths(vaultPath: string): Promise<string[]> {
  const store = await Store.load(STORE_FILE);
  const map = (await store.get<Record<string, string[]>>("expandedByVault")) ?? {};
  return map[vaultPath] ?? [];
}

export async function saveExpandedPaths(
  vaultPath: string,
  expanded: string[],
): Promise<void> {
  const store = await Store.load(STORE_FILE);
  const map = (await store.get<Record<string, string[]>>("expandedByVault")) ?? {};
  map[vaultPath] = expanded.filter((p) => p !== "");
  await store.set("expandedByVault", map);
  await store.save();
}

export type AutoSyncMinutes = 0 | 5 | 15 | 30 | 60;

export type VaultSyncMeta = {
  /** GitHub remote for this vault (URL or resolved origin) */
  remoteUrl: string;
  lastSyncAt: string | null;
  /**
   * Auto-sync interval in minutes for this vault.
   * `0` = off. When set, MarkSpace also syncs when the window becomes visible.
   */
  autoSyncMinutes: AutoSyncMinutes;
};

export const AUTO_SYNC_OPTIONS: { value: AutoSyncMinutes; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 5, label: "Every 5 minutes" },
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
];

export function normalizeAutoSyncMinutes(value: unknown): AutoSyncMinutes {
  return value === 5 || value === 15 || value === 30 || value === 60 ? value : 0;
}

/**
 * Persisted in settings.json as `githubSync`.
 *
 * Sync connection is vault-specific: `byVault[absoluteVaultPath]` holds
 * remote URL, last sync time, and auto-sync interval for that folder only.
 * `token` is a machine-local GitHub credential shared across vaults
 * (not written into the vault / git repo).
 */
export type GithubSyncStore = {
  token: string | null;
  byVault: Record<string, VaultSyncMeta>;
};

const GITHUB_SYNC_KEY = "githubSync";

function normalizeVaultMeta(
  raw: Partial<VaultSyncMeta> | undefined,
): VaultSyncMeta | null {
  if (!raw || typeof raw.remoteUrl !== "string" || !raw.remoteUrl.trim()) {
    return null;
  }
  return {
    remoteUrl: raw.remoteUrl,
    lastSyncAt: typeof raw.lastSyncAt === "string" ? raw.lastSyncAt : null,
    autoSyncMinutes: normalizeAutoSyncMinutes(raw.autoSyncMinutes),
  };
}

export async function loadGithubSync(): Promise<GithubSyncStore> {
  const store = await Store.load(STORE_FILE);
  const raw = await store.get<Partial<GithubSyncStore>>(GITHUB_SYNC_KEY);
  const byVault: Record<string, VaultSyncMeta> = {};
  if (raw?.byVault && typeof raw.byVault === "object") {
    for (const [path, meta] of Object.entries(raw.byVault)) {
      const normalized = normalizeVaultMeta(meta);
      if (normalized) byVault[path] = normalized;
    }
  }
  return {
    token: typeof raw?.token === "string" && raw.token.length > 0 ? raw.token : null,
    byVault,
  };
}

export async function saveGithubToken(token: string | null): Promise<void> {
  const store = await Store.load(STORE_FILE);
  const current = await loadGithubSync();
  await store.set(GITHUB_SYNC_KEY, {
    token: token && token.trim() ? token.trim() : null,
    byVault: current.byVault,
  } satisfies GithubSyncStore);
  await store.save();
}

/** Save or clear sync meta for one vault path (does not affect other vaults). */
export async function saveVaultSyncMeta(
  vaultPath: string,
  meta: VaultSyncMeta | null,
): Promise<void> {
  const store = await Store.load(STORE_FILE);
  const current = await loadGithubSync();
  const byVault = { ...current.byVault };
  if (meta) {
    byVault[vaultPath] = {
      remoteUrl: meta.remoteUrl,
      lastSyncAt: meta.lastSyncAt,
      autoSyncMinutes: normalizeAutoSyncMinutes(meta.autoSyncMinutes),
    };
  } else {
    delete byVault[vaultPath];
  }
  await store.set(GITHUB_SYNC_KEY, {
    token: current.token,
    byVault,
  } satisfies GithubSyncStore);
  await store.save();
}
