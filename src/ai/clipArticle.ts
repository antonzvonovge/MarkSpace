import {
  createNote,
  httpFetchBytes,
  writeAsset,
  writeNote,
} from "../lib/vaultApi";
import { useBackgroundJobsStore } from "../store/backgroundJobsStore";
import { useVaultStore } from "../store/vaultStore";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import {
  fetchTwitterStatusForClip,
  parseTwitterStatusUrl,
} from "./twitterArticle";
import {
  fetchUrlAsMarkdown,
  mergeImageUrlsIntoMarkdown,
  scrapeFirecrawl,
  type WebFetchProvider,
} from "./webTools";

const MAX_CLIP_CHARS = 100_000;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_IMAGES = 20;
/** Parallel image downloads — keeps clip responsive without flooding the host. */
const IMAGE_FETCH_CONCURRENCY = 3;
/** Per-image timeout (seconds); fail fast rather than hang the tool. */
const IMAGE_FETCH_TIMEOUT_SECS = 15;
/** Skip tiny responses that are almost certainly tracking pixels. */
const MIN_IMAGE_BYTES = 200;

export type ClipArticleImageSaved = {
  source: string;
  url: string;
};

export type ClipArticleImageFailed = {
  source: string;
  error: string;
};

/** Fetch backends that can feed a vault clip (includes Firecrawl via scrape_url). */
export type ArticleSaveProvider = WebFetchProvider | "firecrawl";

export type ClipArticleResult =
  | {
      ok: true;
      path: string;
      source_url: string;
      provider: ArticleSaveProvider;
      title: string;
      images_saved: ClipArticleImageSaved[];
      images_failed: ClipArticleImageFailed[];
      images_skipped: number;
      truncated: boolean;
      chars: number;
    }
  | { ok: false; error: string };

export type ClipArticleInput = {
  url: string;
  path?: string;
  /** Vault-relative folder for the note (e.g. `Research/Inbox`). Ignored if `path` is set. */
  folder?: string;
  title?: string;
  download_images?: boolean;
  max_images?: number;
  /**
   * Force fetch backend. Omit to auto-pick Tavily → Jina (unchanged).
   * Pass `firecrawl` only when the user wants a Firecrawl browser scrape into the vault.
   */
  provider?: ArticleSaveProvider;
  /**
   * Fallback when neither `path` nor `folder` is set (usually the active project).
   * Resolves to `{defaultFolder}/Clippings/{slug}.md` or `Clippings/{slug}.md`.
   */
  defaultFolder?: string | null;
  /** 0–100 progress for status bar / UI. */
  onProgress?: (progress: number, detail?: string) => void;
};

async function fetchForClip(
  url: string,
  provider: ArticleSaveProvider | undefined,
): Promise<{
  url: string;
  content: string;
  truncated: boolean;
  provider: ArticleSaveProvider;
}> {
  // X/Twitter long-form posts: Firecrawl returns over-escaped text and no images.
  // Prefer FxTwitter for a clean article body + media URLs.
  if (parseTwitterStatusUrl(url)) {
    try {
      const tw = await fetchTwitterStatusForClip(url);
      if (tw?.content.trim()) {
        let content = tw.content;
        if (tw.imageUrls.length) {
          content = mergeImageUrlsIntoMarkdown(content, tw.imageUrls);
        }
        return {
          url: tw.url,
          content,
          truncated: tw.truncated,
          // Keep the requested provider label when set (e.g. firecrawl).
          provider: provider ?? "jina",
        };
      }
    } catch {
      /* fall through to requested provider */
    }
  }

  if (provider === "firecrawl") {
    const key = useAiSettingsStore.getState().settings.firecrawlApiKey.trim();
    if (!key) {
      throw new Error(
        "Firecrawl provider requested but no Firecrawl API key is set in AI settings",
      );
    }
    const page = await scrapeFirecrawl(url, key, MAX_CLIP_CHARS, {
      forClip: true,
    });
    return {
      url: page.url,
      content: page.content,
      truncated: page.truncated,
      provider: "firecrawl",
    };
  }
  return fetchUrlAsMarkdown(url, MAX_CLIP_CHARS, provider);
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Strip Jina/Tavily reader chrome (Title / URL Source / Markdown Content headers). */
export function stripReaderChrome(markdown: string): string {
  let text = markdown.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (
      /^(Title|URL Source|Markdown Content|Published Time|Warning)\s*:/i.test(
        trimmed,
      )
    ) {
      i += 1;
      continue;
    }
    if (trimmed === "" && i < 8) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n").trim();
}

export function extractArticleTitle(
  markdown: string,
  sourceUrl: string,
  override?: string,
): string {
  const fromOverride = override?.trim();
  if (fromOverride) return fromOverride.slice(0, 200);

  const titleLine = markdown.match(/^\s*Title\s*:\s*(.+)\s*$/im);
  if (titleLine?.[1]?.trim()) return titleLine[1].trim().slice(0, 200);

  const fm = markdown.match(
    /^---\r?\n[\s\S]*?\btitle\s*:\s*["']?([^\n"']+)["']?/i,
  );
  if (fm?.[1]?.trim()) return fm[1].trim().slice(0, 200);

  const cleaned = stripReaderChrome(markdown);
  const h1 = cleaned.match(/^#\s+(.+)$/m);
  if (h1?.[1]?.trim()) return h1[1].trim().slice(0, 200);

  try {
    const u = new URL(sourceUrl);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) {
      const decoded = decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, "");
      if (decoded) return decoded.replace(/[-_]+/g, " ").slice(0, 200);
    }
    return u.hostname;
  } catch {
    return "Clipped article";
  }
}

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s\-]+/gu, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || "clipped-article";
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "image";
}

export function filenameFromImageUrl(url: string, index: number): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const decoded = decodeURIComponent(last).split("?")[0] ?? "";
    if (decoded && /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(decoded)) {
      return sanitizeFileName(decoded);
    }
    if (decoded && decoded !== "." && decoded !== "..") {
      return sanitizeFileName(`${decoded}.img`);
    }
  } catch {
    /* fall through */
  }
  return `image-${index + 1}.img`;
}

function sniffImageExt(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 256)))
    .trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg";
  return null;
}

function ensureImageExt(fileName: string, ext: string | null): string {
  if (!ext) return fileName.endsWith(".img") ? fileName.replace(/\.img$/, ".bin") : fileName;
  if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(fileName)) {
    return fileName.replace(/\.[a-z0-9]+$/i, `.${ext === "jpg" ? "jpg" : ext}`);
  }
  if (fileName.endsWith(".img") || fileName.endsWith(".bin")) {
    return fileName.replace(/\.(img|bin)$/i, `.${ext}`);
  }
  return `${fileName}.${ext}`;
}

function extFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (base) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/avif":
      return "avif";
    case "image/bmp":
    case "image/x-ms-bmp":
      return "bmp";
    default:
      return base.startsWith("image/") ? "img" : null;
  }
}

/**
 * Collect unique http(s) image URLs from markdown `![]()` and HTML `<img src>`.
 * Order follows first appearance.
 */
export function extractImageUrls(markdown: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const url = raw.trim();
    if (!isHttpUrl(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const mdRe = /!\[[^\]]*]\(\s*<?(https?:\/\/[^)\s>]+)>?\s*\)/gi;
  for (const m of markdown.matchAll(mdRe)) {
    if (m[1]) push(m[1]);
  }

  const htmlRe = /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  for (const m of markdown.matchAll(htmlRe)) {
    if (m[1]) push(m[1]);
  }

  return out;
}

/** Replace remote image URLs with local `.assets/…` paths (exact string match). */
export function rewriteImageUrls(
  markdown: string,
  mapping: Map<string, string>,
): string {
  let result = markdown;
  for (const [remote, local] of mapping) {
    if (!remote || !local || remote === local) continue;
    result = result.split(remote).join(local);
  }
  return result;
}

export function buildClipMarkdown(opts: {
  title: string;
  sourceUrl: string;
  body: string;
}): string {
  const body = opts.body.trim();
  const sourceLine = `Source: ${opts.sourceUrl}`;
  const heading = `# ${opts.title}`;

  // Avoid duplicating an identical H1 from the reader body.
  const bodyWithoutDupH1 = body.replace(
    new RegExp(
      `^#\\s+${escapeRegExp(opts.title)}\\s*(?:\\r?\\n)+`,
      "i",
    ),
    "",
  );

  const bodyClean = bodyWithoutDupH1.trim().replace(/\n{3,}/g, "\n\n");
  return `${heading}\n\n${sourceLine}\n\n${bodyClean}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveClipNotePath(opts: {
  path?: string;
  folder?: string;
  title: string;
  defaultFolder?: string | null;
}): string {
  const explicit = opts.path?.trim().replace(/^\/+/, "");
  if (explicit) {
    return explicit.toLowerCase().endsWith(".md") ? explicit : `${explicit}.md`;
  }
  const slug = slugifyTitle(opts.title);
  const folder = opts.folder?.trim().replace(/^\/+|\/+$/g, "");
  if (folder) {
    return `${folder}/${slug}.md`;
  }
  const fallback = (
    opts.defaultFolder?.trim().replace(/\/+$/, "") || "Clippings"
  ).replace(/^\/+/, "");
  const base =
    fallback.toLowerCase() === "clippings" || fallback.endsWith("/Clippings")
      ? fallback
      : `${fallback}/Clippings`;
  return `${base}/${slug}.md`;
}

async function createNoteUnique(desiredPath: string): Promise<string> {
  const normalized = desiredPath.toLowerCase().endsWith(".md")
    ? desiredPath
    : `${desiredPath}.md`;
  const dot = normalized.lastIndexOf(".");
  const stem = normalized.slice(0, dot);
  const ext = normalized.slice(dot);

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? normalized : `${stem}-${attempt + 1}${ext}`;
    try {
      return await createNote(candidate);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already exists/i.test(msg)) throw e;
    }
  }
  throw new Error(`Could not create a unique note path near ${normalized}`);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), Math.max(items.length, 1)) },
    async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        results[i] = await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

type ImageDownloadOutcome =
  | { source: string; ok: true; url: string }
  | { source: string; ok: false; error: string };

/**
 * Fetch a web article as markdown, create a vault note, and optionally download
 * remote images into the note's sibling `.assets/` folder (rewriting links).
 */
export async function clipArticle(
  input: ClipArticleInput,
): Promise<ClipArticleResult> {
  const url = input.url.trim();
  const report = (progress: number, detail?: string) => {
    input.onProgress?.(progress, detail);
  };

  if (!isHttpUrl(url)) {
    return { ok: false, error: "Only http(s) URLs are allowed" };
  }

  try {
    report(5, "Fetching article");
    const page = await fetchForClip(url, input.provider);
    const title = extractArticleTitle(page.content, page.url, input.title);
    const body = stripReaderChrome(page.content);
    const notePath = resolveClipNotePath({
      path: input.path,
      folder: input.folder,
      title,
      defaultFolder: input.defaultFolder,
    });

    report(25, "Creating note");
    const created = await createNoteUnique(notePath);
    let markdown = buildClipMarkdown({
      title,
      sourceUrl: page.url,
      body,
    });

    // Persist text first so a hung/failed image pack still leaves a usable note.
    report(35, title);
    await writeNote(created, markdown);
    await useVaultStore.getState().refreshTree();
    await yieldToUi();

    const downloadImages = input.download_images !== false;
    const maxImages = Math.min(
      Math.max(input.max_images ?? DEFAULT_MAX_IMAGES, 0),
      50,
    );

    const imagesSaved: ClipArticleImageSaved[] = [];
    const imagesFailed: ClipArticleImageFailed[] = [];
    let imagesSkipped = 0;

    if (downloadImages && maxImages > 0) {
      const allUrls = extractImageUrls(markdown);
      const toFetch = allUrls.slice(0, maxImages);
      imagesSkipped = Math.max(0, allUrls.length - toFetch.length);
      const mapping = new Map<string, string>();
      let finished = 0;

      if (toFetch.length > 0) {
        report(40, `Downloading images (0/${toFetch.length})`);
      }

      const outcomes = await mapPool(
        toFetch,
        IMAGE_FETCH_CONCURRENCY,
        async (imageUrl, i): Promise<ImageDownloadOutcome> => {
          try {
            const res = await httpFetchBytes(imageUrl, {
              timeoutSecs: IMAGE_FETCH_TIMEOUT_SECS,
            });
            if (res.status < 200 || res.status >= 300) {
              return { source: imageUrl, ok: false, error: `HTTP ${res.status}` };
            }
            if (res.byteLength > MAX_ASSET_BYTES) {
              return {
                source: imageUrl,
                ok: false,
                error: `Too large (${res.byteLength} bytes)`,
              };
            }
            if (res.byteLength < MIN_IMAGE_BYTES) {
              return {
                source: imageUrl,
                ok: false,
                error: "Too small (likely tracking pixel)",
              };
            }

            const bytes = base64ToBytes(res.dataBase64);
            const sniffed =
              sniffImageExt(bytes) ?? extFromContentType(res.contentType);
            if (!sniffed) {
              return {
                source: imageUrl,
                ok: false,
                error: `Not an image (${res.contentType ?? "unknown type"})`,
              };
            }

            const fileName = ensureImageExt(
              filenameFromImageUrl(imageUrl, i),
              sniffed === "img" ? null : sniffed,
            );
            const localUrl = await writeAsset(created, fileName, bytes);
            await yieldToUi();
            return { source: imageUrl, ok: true, url: localUrl };
          } catch (e) {
            await yieldToUi();
            return {
              source: imageUrl,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            };
          } finally {
            finished += 1;
            const pct =
              40 + Math.round((finished / Math.max(toFetch.length, 1)) * 50);
            report(
              Math.min(90, pct),
              `Downloading images (${finished}/${toFetch.length})`,
            );
          }
        },
      );

      for (const outcome of outcomes) {
        if (outcome.ok) {
          mapping.set(outcome.source, outcome.url);
          imagesSaved.push({ source: outcome.source, url: outcome.url });
        } else {
          imagesFailed.push({ source: outcome.source, error: outcome.error });
        }
      }

      if (mapping.size > 0) {
        report(92, "Saving images");
        markdown = rewriteImageUrls(markdown, mapping);
        await writeNote(created, markdown);
        await useVaultStore.getState().refreshTree();
        await yieldToUi();
      }
    }

    report(100, created);
    return {
      ok: true,
      path: created,
      source_url: page.url,
      provider: page.provider,
      title,
      images_saved: imagesSaved,
      images_failed: imagesFailed,
      images_skipped: imagesSkipped,
      truncated: page.truncated,
      chars: markdown.length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const ERROR_HIDE_MS = 8_000;
let clipJobSeq = 0;
const clipErrorHideTimers = new Map<string, number>();

function reportClipJob(
  jobId: string,
  patch: {
    label: string;
    progress: number;
    status: "running" | "error" | "done";
    detail?: string;
  },
) {
  const prev = clipErrorHideTimers.get(jobId);
  if (prev != null) {
    window.clearTimeout(prev);
    clipErrorHideTimers.delete(jobId);
  }
  useBackgroundJobsStore.getState().upsertJob({
    id: jobId,
    label: patch.label,
    progress: patch.progress,
    status: patch.status,
    detail: patch.detail,
  });
  if (patch.status === "error") {
    const timer = window.setTimeout(() => {
      clipErrorHideTimers.delete(jobId);
      useBackgroundJobsStore.getState().removeJob(jobId);
    }, ERROR_HIDE_MS);
    clipErrorHideTimers.set(jobId, timer);
  }
}

function shortHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "article";
  }
}

/**
 * Fire-and-forget clip into a vault folder. Progress appears in the status bar;
 * opens the note when finished.
 */
export function startClipArticleJob(opts: {
  url: string;
  folder?: string;
}): void {
  const url = opts.url.trim();
  const folder = opts.folder?.trim().replace(/^\/+|\/+$/g, "") || undefined;
  const jobId = `clip-article:${++clipJobSeq}`;
  const label = `Downloading ${shortHost(url)}`;

  reportClipJob(jobId, {
    label,
    progress: 0,
    status: "running",
    detail: url,
  });

  void (async () => {
    try {
      const result = await clipArticle({
        url,
        folder,
        onProgress: (progress, detail) => {
          reportClipJob(jobId, {
            label,
            progress,
            status: "running",
            detail: detail ?? url,
          });
        },
      });
      if (!result.ok) {
        reportClipJob(jobId, {
          label,
          progress: 0,
          status: "error",
          detail: result.error,
        });
        return;
      }
      reportClipJob(jobId, {
        label: `Saved ${result.title}`,
        progress: 100,
        status: "done",
        detail: result.path,
      });
      await useVaultStore.getState().openNote(result.path, { preview: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reportClipJob(jobId, {
        label,
        progress: 0,
        status: "error",
        detail: msg || "Download failed",
      });
    }
  })();
}

/** @internal exported for tests */
export const _test = {
  isHttpUrl,
  sniffImageExt,
  ensureImageExt,
  createNoteUnique,
};
