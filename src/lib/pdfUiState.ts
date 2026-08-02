/** Per-document PDF viewer UI (page, zoom). */

export const PDF_SCALE_DEFAULT = 1.15;
export const PDF_SCALE_MIN = 0.5;
export const PDF_SCALE_MAX = 3;

const STORAGE_KEY = "markspace-pdf-ui-v1";

export type DocPdfUi = {
  /** 1-based page last viewed. */
  page: number;
  scale: number;
  fitWidth: boolean;
};

type StoreMap = Record<string, DocPdfUi>;

const DEFAULT_UI: DocPdfUi = {
  page: 1,
  scale: PDF_SCALE_DEFAULT,
  fitWidth: false,
};

export function clampPdfScale(n: number): number {
  return Math.min(
    PDF_SCALE_MAX,
    Math.max(PDF_SCALE_MIN, Math.round(n * 100) / 100),
  );
}

export function clampPdfPage(n: number, maxPages?: number): number {
  const page = Math.max(1, Math.floor(n));
  if (maxPages != null && maxPages >= 1) {
    return Math.min(page, maxPages);
  }
  return page;
}

function storageKey(
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

function normalizeEntry(raw: unknown): DocPdfUi | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Partial<DocPdfUi>;
  const page =
    typeof obj.page === "number" && Number.isFinite(obj.page)
      ? clampPdfPage(obj.page)
      : 1;
  const scale =
    typeof obj.scale === "number" && Number.isFinite(obj.scale)
      ? clampPdfScale(obj.scale)
      : PDF_SCALE_DEFAULT;
  const fitWidth = obj.fitWidth === true;
  return { page, scale, fitWidth };
}

function readEntry(
  vaultPath: string | null | undefined,
  notePath: string,
): DocPdfUi {
  return (
    normalizeEntry(readStore()[storageKey(vaultPath, notePath)]) ?? {
      ...DEFAULT_UI,
    }
  );
}

function patchEntry(
  vaultPath: string | null | undefined,
  notePath: string,
  patch: Partial<DocPdfUi>,
): void {
  const key = storageKey(vaultPath, notePath);
  const map = readStore();
  const prev = normalizeEntry(map[key]) ?? { ...DEFAULT_UI };
  map[key] = { ...prev, ...patch };
  writeStore(map);
}

export function loadDocPdfUi(
  vaultPath: string | null | undefined,
  notePath: string,
): DocPdfUi {
  return readEntry(vaultPath, notePath);
}

export function saveDocPdfPage(
  vaultPath: string | null | undefined,
  notePath: string,
  page: number,
): void {
  patchEntry(vaultPath, notePath, { page: clampPdfPage(page) });
}

export function saveDocPdfZoom(
  vaultPath: string | null | undefined,
  notePath: string,
  scale: number,
  fitWidth: boolean,
): void {
  patchEntry(vaultPath, notePath, {
    scale: clampPdfScale(scale),
    fitWidth: Boolean(fitWidth),
  });
}
