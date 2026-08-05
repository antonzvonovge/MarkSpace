/** Per-document comments panel UI (open, splitter width). */

export const COMMENTS_WIDTH_DEFAULT = 260;
export const COMMENTS_WIDTH_MIN = 180;
export const COMMENTS_WIDTH_MAX = 480;

const STORAGE_KEY = "markspace-comments-ui-v1";

export type DocCommentsUi = {
  /** Sticky comments panel toggle for this note. */
  open: boolean;
  width: number;
};

type StoreMap = Record<string, DocCommentsUi>;

const DEFAULT_UI: DocCommentsUi = {
  open: false,
  width: COMMENTS_WIDTH_DEFAULT,
};

export function clampCommentsWidth(n: number): number {
  return Math.min(
    COMMENTS_WIDTH_MAX,
    Math.max(COMMENTS_WIDTH_MIN, Math.round(n)),
  );
}

export function commentsUiStorageKey(
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

function normalizeEntry(raw: unknown): DocCommentsUi | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Partial<DocCommentsUi>;
  const width =
    typeof obj.width === "number" && Number.isFinite(obj.width)
      ? clampCommentsWidth(obj.width)
      : COMMENTS_WIDTH_DEFAULT;
  const open = obj.open === true;
  return { open, width };
}

function readEntry(
  vaultPath: string | null | undefined,
  notePath: string,
): DocCommentsUi {
  return (
    normalizeEntry(readStore()[commentsUiStorageKey(vaultPath, notePath)]) ?? {
      ...DEFAULT_UI,
    }
  );
}

function patchEntry(
  vaultPath: string | null | undefined,
  notePath: string,
  patch: Partial<DocCommentsUi>,
): void {
  const key = commentsUiStorageKey(vaultPath, notePath);
  const map = readStore();
  const prev = normalizeEntry(map[key]) ?? { ...DEFAULT_UI };
  map[key] = { ...prev, ...patch };
  writeStore(map);
}

export function loadDocCommentsUi(
  vaultPath: string | null | undefined,
  notePath: string,
): DocCommentsUi {
  return readEntry(vaultPath, notePath);
}

export function saveDocCommentsOpen(
  vaultPath: string | null | undefined,
  notePath: string,
  open: boolean,
): void {
  patchEntry(vaultPath, notePath, { open: Boolean(open) });
}

export function saveDocCommentsWidth(
  vaultPath: string | null | undefined,
  notePath: string,
  width: number,
): void {
  patchEntry(vaultPath, notePath, { width: clampCommentsWidth(width) });
}

/** Sidebar inbox: show resolved comments. */
const INBOX_SHOW_RESOLVED_KEY = "markspace-comments-inbox-show-resolved-v1";
const INBOX_COLLAPSED_KEY = "markspace-comments-inbox-collapsed-v1";

export function loadCommentsInboxShowResolved(): boolean {
  try {
    return localStorage.getItem(INBOX_SHOW_RESOLVED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveCommentsInboxShowResolved(show: boolean): void {
  try {
    localStorage.setItem(INBOX_SHOW_RESOLVED_KEY, show ? "1" : "0");
  } catch {
    // ignore
  }
}

/** Sidebar Comments section collapsed (header still visible). */
export function loadCommentsInboxCollapsed(): boolean {
  try {
    return localStorage.getItem(INBOX_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveCommentsInboxCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(INBOX_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}
