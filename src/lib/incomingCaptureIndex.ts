import { readNote } from "./vaultApi";
import { noteBody, splitFrontmatter } from "./noteFrontmatter";
import { getIncomingCaptureRevision } from "./incomingUiState";

export type IncomingCaptureEntry = {
  path: string;
  snippet: string;
  captured: string;
  source: string;
};

type CacheEntry = IncomingCaptureEntry;

let cacheRevision = -1;
const cache = new Map<string, CacheEntry>();

function snippet(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function capturedFromSplit(
  split: ReturnType<typeof splitFrontmatter>,
  path: string,
): string {
  const raw = split.data?.captured;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

function parseCaptureEntry(path: string, markdown: string): CacheEntry {
  const split = splitFrontmatter(markdown);
  const body = noteBody(markdown).trim();
  const source =
    typeof split.data?.source === "string" ? split.data.source.trim() : "";
  return {
    path,
    snippet: snippet(body),
    captured: capturedFromSplit(split, path),
    source,
  };
}

export function invalidateIncomingCaptureIndex(): void {
  cache.clear();
  cacheRevision = -1;
}

/** Load capture snippets for Incoming `.md` paths (parallel read, cached per revision). */
export async function loadIncomingCaptureEntries(
  paths: string[],
): Promise<IncomingCaptureEntry[]> {
  const revision = getIncomingCaptureRevision();
  if (revision !== cacheRevision) {
    cache.clear();
    cacheRevision = revision;
  }

  const mdPaths = paths.filter((p) => p.toLowerCase().endsWith(".md"));
  if (mdPaths.length === 0) return [];

  const results = await Promise.all(
    mdPaths.map(async (path) => {
      const hit = cache.get(path);
      if (hit) return hit;
      try {
        const markdown = await readNote(path);
        const entry = parseCaptureEntry(path, markdown);
        cache.set(path, entry);
        return entry;
      } catch {
        const fallback: CacheEntry = {
          path,
          snippet: "",
          captured: path.split("/").pop()?.replace(/\.md$/i, "") ?? path,
          source: "",
        };
        cache.set(path, fallback);
        return fallback;
      }
    }),
  );

  return [...results].sort((a, b) => b.captured.localeCompare(a.captured));
}

export function formatCaptureListTime(isoOrLabel: string): string {
  const d = new Date(isoOrLabel);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return isoOrLabel;
}
