import { Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_PREFS,
  isNativeLanguageId,
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
    typeof raw.editorFontSize === "number" &&
    Number.isFinite(raw.editorFontSize)
      ? Math.min(28, Math.max(11, Math.round(raw.editorFontSize)))
      : undefined;

  const userName =
    typeof raw.userName === "string"
      ? raw.userName.trim().slice(0, 80)
      : DEFAULT_PREFS.userName;

  return {
    userName,
    nativeLanguage: isNativeLanguageId(raw.nativeLanguage)
      ? raw.nativeLanguage
      : DEFAULT_PREFS.nativeLanguage,
    theme:
      raw.theme === "dark" || raw.theme === "light"
        ? raw.theme
        : DEFAULT_PREFS.theme,
    uiDensity:
      raw.uiDensity === "compact" || raw.uiDensity === "comfortable"
        ? raw.uiDensity
        : DEFAULT_PREFS.uiDensity,
    uiFontSize:
      typeof raw.uiFontSize === "number" && Number.isFinite(raw.uiFontSize)
        ? Math.min(20, Math.max(11, Math.round(raw.uiFontSize)))
        : DEFAULT_PREFS.uiFontSize,
    liveFontSize: clampFontSize(
      raw.liveFontSize ?? legacySize,
      DEFAULT_PREFS.liveFontSize,
    ),
    liveFontSizeDiary: clampFontSize(
      raw.liveFontSizeDiary ?? raw.liveFontSize ?? legacySize,
      DEFAULT_PREFS.liveFontSizeDiary,
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
  const map =
    (await store.get<Record<string, string[]>>("expandedByVault")) ?? {};
  return map[vaultPath] ?? [];
}

export async function saveExpandedPaths(
  vaultPath: string,
  expanded: string[],
): Promise<void> {
  const store = await Store.load(STORE_FILE);
  const map =
    (await store.get<Record<string, string[]>>("expandedByVault")) ?? {};
  map[vaultPath] = expanded.filter((p) => p !== "");
  await store.set("expandedByVault", map);
  await store.save();
}

/** Sigma camera pose — vault-local, restored when the graph tab reopens. */
export type GraphCameraState = {
  x: number;
  y: number;
  ratio: number;
  angle: number;
};

export type GraphUiSettings = {
  tagsOnly: boolean;
  showUntagged: boolean;
  labelThreshold: number;
  /** Layout spread, 0 (tight ball) … 1 (loose constellation). */
  spread: number;
  /** First-level vault project path; null means the entire vault. */
  projectPath: string | null;
  /** Last camera pose; null means “fit content on next open”. */
  camera: GraphCameraState | null;
};

export const DEFAULT_GRAPH_UI_SETTINGS: GraphUiSettings = {
  tagsOnly: false,
  showUntagged: false,
  labelThreshold: 7,
  spread: 0.5,
  projectPath: null,
  camera: null,
};

const GRAPH_UI_BY_VAULT_KEY = "graphUiByVault";

/** Pre-spread vaults stored a raw ForceAtlas2 gravity (0.2 … 4). */
function spreadFromLegacyGravity(gravity: number): number {
  const clamped = Math.min(4, Math.max(0.2, gravity));
  return Math.min(1, Math.max(0, 1 - (Math.log(clamped) + 1.61) / 3.3));
}

function normalizeCamera(raw: unknown): GraphCameraState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<GraphCameraState>;
  const { x, y, ratio, angle } = value;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof ratio !== "number" ||
    !Number.isFinite(ratio) ||
    typeof angle !== "number" ||
    !Number.isFinite(angle)
  ) {
    return null;
  }
  return { x, y, ratio: Math.max(0.0001, ratio), angle };
}

function normalizeGraphUiSettings(raw: unknown): GraphUiSettings {
  const value: Partial<GraphUiSettings> & { gravity?: unknown } =
    raw && typeof raw === "object"
      ? (raw as Partial<GraphUiSettings> & { gravity?: unknown })
      : DEFAULT_GRAPH_UI_SETTINGS;
  const labelThreshold =
    typeof value.labelThreshold === "number" &&
    Number.isFinite(value.labelThreshold)
      ? Math.min(10, Math.max(0, value.labelThreshold))
      : DEFAULT_GRAPH_UI_SETTINGS.labelThreshold;
  const spread =
    typeof value.spread === "number" && Number.isFinite(value.spread)
      ? Math.min(1, Math.max(0, value.spread))
      : typeof value.gravity === "number" && Number.isFinite(value.gravity)
        ? spreadFromLegacyGravity(value.gravity)
        : DEFAULT_GRAPH_UI_SETTINGS.spread;
  return {
    tagsOnly: Boolean(value.tagsOnly),
    showUntagged: Boolean(value.showUntagged),
    labelThreshold,
    spread,
    projectPath:
      typeof value.projectPath === "string" && value.projectPath.trim()
        ? value.projectPath
        : null,
    camera: normalizeCamera(value.camera),
  };
}

export async function loadGraphUiSettings(
  vaultPath: string,
): Promise<GraphUiSettings> {
  const store = await Store.load(STORE_FILE);
  const map =
    (await store.get<Record<string, unknown>>(GRAPH_UI_BY_VAULT_KEY)) ?? {};
  return normalizeGraphUiSettings(map[vaultPath]);
}

export async function saveGraphUiSettings(
  vaultPath: string,
  settings: GraphUiSettings,
): Promise<void> {
  const store = await Store.load(STORE_FILE);
  const map =
    (await store.get<Record<string, GraphUiSettings>>(GRAPH_UI_BY_VAULT_KEY)) ??
    {};
  map[vaultPath] = normalizeGraphUiSettings(settings);
  await store.set(GRAPH_UI_BY_VAULT_KEY, map);
  await store.save();
}

export type SavedTabKind = "file" | "graph" | "settings";

export type SavedEditorTab = {
  path: string;
  preview: boolean;
  kind?: SavedTabKind;
  /** Cursor-style sticky pin (left group). Distinct from preview keep-open. */
  pinned?: boolean;
};

export type VaultSession = {
  tabs: SavedEditorTab[];
  activePath: string | null;
};

const VAULT_SESSIONS_KEY = "vaultSessions";

function normalizeSavedTabKind(kind: unknown, path: string): SavedTabKind {
  if (kind === "graph" || path === "markspace:graph") return "graph";
  if (kind === "settings" || path === "markspace:settings") return "settings";
  return "file";
}

export async function loadVaultSession(
  vaultPath: string,
): Promise<VaultSession | null> {
  const store = await Store.load(STORE_FILE);
  const map =
    (await store.get<Record<string, VaultSession>>(VAULT_SESSIONS_KEY)) ?? {};
  const raw = map[vaultPath];
  if (!raw || !Array.isArray(raw.tabs)) return null;
  const tabs = raw.tabs
    .filter(
      (t): t is SavedEditorTab =>
        !!t &&
        typeof t === "object" &&
        typeof t.path === "string" &&
        t.path.length > 0,
    )
    .map((t) => ({
      path: t.path,
      preview: Boolean(t.preview) && !Boolean(t.pinned),
      kind: normalizeSavedTabKind(t.kind, t.path),
      pinned: Boolean(t.pinned),
    }));
  // A saved session with no tabs means the user closed everything: keep it
  // distinct from "no session at all" so the caller skips the welcome note.
  if (!tabs.length) return { tabs: [], activePath: null };
  const activePath =
    typeof raw.activePath === "string" &&
    tabs.some((t) => t.path === raw.activePath)
      ? raw.activePath
      : tabs[0].path;
  return { tabs, activePath };
}

export async function saveVaultSession(
  vaultPath: string,
  session: VaultSession,
): Promise<void> {
  const store = await Store.load(STORE_FILE);
  const map =
    (await store.get<Record<string, VaultSession>>(VAULT_SESSIONS_KEY)) ?? {};
  map[vaultPath] = {
    tabs: session.tabs.map((t) => ({
      path: t.path,
      preview: Boolean(t.preview) && !Boolean(t.pinned),
      kind: normalizeSavedTabKind(t.kind, t.path),
      pinned: Boolean(t.pinned),
    })),
    activePath: session.activePath,
  };
  await store.set(VAULT_SESSIONS_KEY, map);
  await store.save();
}

/** Max recent files shown in Quick Open when the query is empty. */
export const RECENT_FILES_LIMIT = 10;

const VAULT_RECENT_FILES_KEY = "vaultRecentFiles";

function normalizeRecentPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= RECENT_FILES_LIMIT) break;
  }
  return out;
}

/** Remap or drop recent paths after move/rename/delete (`to` null = delete). */
export function remapRecentPathList(
  paths: string[],
  from: string,
  to: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    let next = p;
    if (p === from || p.startsWith(`${from}/`)) {
      if (to == null) continue;
      next = p === from ? to : `${to}${p.slice(from.length)}`;
    }
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    if (out.length >= RECENT_FILES_LIMIT) break;
  }
  return out;
}

export async function loadRecentFiles(vaultPath: string): Promise<string[]> {
  const store = await Store.load(STORE_FILE);
  const map =
    (await store.get<Record<string, string[]>>(VAULT_RECENT_FILES_KEY)) ?? {};
  return normalizeRecentPaths(map[vaultPath]);
}

export async function saveRecentFiles(
  vaultPath: string,
  paths: string[],
): Promise<void> {
  const store = await Store.load(STORE_FILE);
  const map =
    (await store.get<Record<string, string[]>>(VAULT_RECENT_FILES_KEY)) ?? {};
  map[vaultPath] = normalizeRecentPaths(paths);
  await store.set(VAULT_RECENT_FILES_KEY, map);
  await store.save();
}

/** Move `path` to the front of the vault MRU list (deduped, capped). */
export function pushRecentPath(paths: string[], path: string): string[] {
  return normalizeRecentPaths([path, ...paths.filter((p) => p !== path)]);
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
  return value === 5 || value === 15 || value === 30 || value === 60
    ? value
    : 0;
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
    token:
      typeof raw?.token === "string" && raw.token.length > 0 ? raw.token : null,
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
