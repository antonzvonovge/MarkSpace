/** Per-document editor scroll (Live / Source). Survives tab switches and restarts. */

const STORAGE_KEY = "markspace-editor-scroll-v1";

export type EditorScrollPane = "live" | "source";

export type DocEditorScroll = {
  live: number;
  source: number;
};

type StoreMap = Record<string, DocEditorScroll>;

const DEFAULT_SCROLL: DocEditorScroll = { live: 0, source: 0 };

export function editorScrollStorageKey(
  vaultPath: string | null | undefined,
  notePath: string,
): string {
  return `${vaultPath ?? ""}\n${notePath}`;
}

function clampTop(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
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

function normalizeEntry(raw: unknown): DocEditorScroll | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Partial<DocEditorScroll>;
  const live =
    typeof obj.live === "number" && Number.isFinite(obj.live)
      ? clampTop(obj.live)
      : 0;
  const source =
    typeof obj.source === "number" && Number.isFinite(obj.source)
      ? clampTop(obj.source)
      : 0;
  return { live, source };
}

function readEntry(
  vaultPath: string | null | undefined,
  notePath: string,
): DocEditorScroll {
  return (
    normalizeEntry(
      readStore()[editorScrollStorageKey(vaultPath, notePath)],
    ) ?? { ...DEFAULT_SCROLL }
  );
}

function patchEntry(
  vaultPath: string | null | undefined,
  notePath: string,
  pane: EditorScrollPane,
  top: number,
): void {
  const key = editorScrollStorageKey(vaultPath, notePath);
  const map = readStore();
  const prev = normalizeEntry(map[key]) ?? { ...DEFAULT_SCROLL };
  const next: DocEditorScroll = { ...prev, [pane]: clampTop(top) };
  if (prev.live === next.live && prev.source === next.source) return;
  if (next.live === 0 && next.source === 0) {
    delete map[key];
  } else {
    map[key] = next;
  }
  writeStore(map);
}

export function loadDocEditorScroll(
  vaultPath: string | null | undefined,
  notePath: string,
  pane: EditorScrollPane,
): number {
  return readEntry(vaultPath, notePath)[pane];
}

export function saveDocEditorScroll(
  vaultPath: string | null | undefined,
  notePath: string,
  pane: EditorScrollPane,
  top: number,
): void {
  patchEntry(vaultPath, notePath, pane, top);
}
