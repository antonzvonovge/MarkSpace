/** Per-document outline UI (open, splitter width, collapsed nodes). */

export const OUTLINE_WIDTH_DEFAULT = 220;
export const OUTLINE_WIDTH_MIN = 140;
export const OUTLINE_WIDTH_MAX = 480;

const STORAGE_KEY = "markspace-outline-ui-v1";

export type DocOutlineUi = {
  /** Sticky TOC toggle for this note. */
  open: boolean;
  width: number;
  /** Stable outline keys (`level:text` / `level:text#n`), not BlockNote block ids. */
  collapsed: string[];
};

type StoreMap = Record<string, DocOutlineUi>;

const DEFAULT_UI: DocOutlineUi = {
  open: false,
  width: OUTLINE_WIDTH_DEFAULT,
  collapsed: [],
};

export function clampOutlineWidth(n: number): number {
  return Math.min(
    OUTLINE_WIDTH_MAX,
    Math.max(OUTLINE_WIDTH_MIN, Math.round(n)),
  );
}

export function outlineUiStorageKey(
  vaultPath: string | null | undefined,
  notePath: string,
): string {
  return `${vaultPath ?? ""}\n${notePath}`;
}

function readStore(): StoreMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as StoreMap;
  } catch {
    return {};
  }
}

function writeStore(map: StoreMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

function normalizeEntry(raw: unknown): DocOutlineUi | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Partial<DocOutlineUi>;
  const width =
    typeof obj.width === "number" && Number.isFinite(obj.width)
      ? clampOutlineWidth(obj.width)
      : OUTLINE_WIDTH_DEFAULT;
  const collapsed = Array.isArray(obj.collapsed)
    ? obj.collapsed.filter((k): k is string => typeof k === "string" && k.length > 0)
    : [];
  const open = obj.open === true;
  return { open, width, collapsed };
}

function readEntry(
  vaultPath: string | null | undefined,
  notePath: string,
): DocOutlineUi {
  return (
    normalizeEntry(readStore()[outlineUiStorageKey(vaultPath, notePath)]) ?? {
      ...DEFAULT_UI,
    }
  );
}

function patchEntry(
  vaultPath: string | null | undefined,
  notePath: string,
  patch: Partial<DocOutlineUi>,
): void {
  const key = outlineUiStorageKey(vaultPath, notePath);
  const map = readStore();
  const prev = normalizeEntry(map[key]) ?? { ...DEFAULT_UI };
  map[key] = { ...prev, ...patch };
  writeStore(map);
}

export function loadDocOutlineUi(
  vaultPath: string | null | undefined,
  notePath: string,
): DocOutlineUi {
  return readEntry(vaultPath, notePath);
}

export function saveDocOutlineOpen(
  vaultPath: string | null | undefined,
  notePath: string,
  open: boolean,
): void {
  patchEntry(vaultPath, notePath, { open: Boolean(open) });
}

export function saveDocOutlineWidth(
  vaultPath: string | null | undefined,
  notePath: string,
  width: number,
): void {
  patchEntry(vaultPath, notePath, { width: clampOutlineWidth(width) });
}

export function saveDocOutlineCollapsed(
  vaultPath: string | null | undefined,
  notePath: string,
  collapsed: Iterable<string>,
): void {
  patchEntry(vaultPath, notePath, {
    collapsed: [...new Set(collapsed)].filter((k) => k.length > 0),
  });
}
