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
