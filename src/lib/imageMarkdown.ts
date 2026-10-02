/** Image size projection for BlockNote ↔ markdown round-trip (Obsidian-style). */

export type ImageSizeRef = {
  url: string;
  name?: string;
  previewWidth?: number;
  /** Set only when the image is stretched to an explicit height. */
  previewHeight?: number;
};

type BlockLike = {
  type?: string;
  props?: Record<string, unknown>;
  children?: BlockLike[];
};

/** Collect image blocks (depth-first) for size projection. */
export function collectImageSizeRefs(blocks: BlockLike[]): ImageSizeRef[] {
  const out: ImageSizeRef[] = [];
  for (const block of blocks) {
    if (block.type === "image") {
      const url = String(block.props?.url ?? "");
      if (url) {
        const width = Number(block.props?.previewWidth);
        const height = Number(block.props?.previewHeight);
        const ref: ImageSizeRef = {
          url,
          name: String(block.props?.name ?? ""),
          previewWidth:
            Number.isFinite(width) && width > 0 ? Math.round(width) : undefined,
        };
        if (Number.isFinite(height) && height > 0) {
          ref.previewHeight = Math.round(height);
        }
        out.push(ref);
      }
    }
    if (block.children?.length) {
      out.push(...collectImageSizeRefs(block.children));
    }
  }
  return out;
}

/**
 * Write image size into markdown that BlockNote's lossy exporter omitted.
 * Non-captioned: `![alt|width](src)` / `![alt|widthxheight](src)`.
 * Captioned (HTML figure): inject `width` and, when set, `height` on the `<img>`.
 */
export function applyImagePreviewWidths(
  markdown: string,
  images: ImageSizeRef[],
): string {
  let result = markdown;
  let cursor = 0;

  for (const image of images) {
    const hit = findNextImageRef(result, image.url, cursor);
    if (!hit) continue;

    if (!image.previewWidth) {
      cursor = hit.end;
      continue;
    }

    const replacement =
      hit.kind === "md"
        ? formatSizedMarkdownImage(
            image.name ?? hit.alt,
            hit.src,
            image.previewWidth,
            image.previewHeight,
          )
        : injectImgSize(hit.text, image.previewWidth, image.previewHeight);

    result = result.slice(0, hit.start) + replacement + result.slice(hit.end);
    cursor = hit.start + replacement.length;
  }

  return result;
}

/**
 * After BlockNote parses `![alt|width](src)` / `![alt|widthxheight](src)`, the
 * size lives in `name`. Move it onto `previewWidth` / `previewHeight`.
 */
export function restoreImagePreviewWidthsFromAlt<T extends BlockLike>(
  blocks: T[],
): T[] {
  return blocks.map((block) => {
    let next: BlockLike = block;

    if (block.type === "image" && block.props) {
      const existing = Number(block.props.previewWidth);
      const hasExisting = Number.isFinite(existing) && existing > 0;
      const existingHeight = Number(block.props.previewHeight);
      const hasExistingHeight =
        Number.isFinite(existingHeight) && existingHeight > 0;
      const parsed = parseSizedAlt(String(block.props.name ?? ""));
      if (parsed) {
        const previewHeight = hasExistingHeight
          ? existingHeight
          : parsed.previewHeight;
        next = {
          ...block,
          props: {
            ...block.props,
            name: parsed.name,
            previewWidth: hasExisting ? existing : parsed.previewWidth,
            ...(previewHeight ? { previewHeight } : {}),
          },
        };
      }
    }

    if (next.children?.length) {
      next = {
        ...next,
        children: restoreImagePreviewWidthsFromAlt(next.children),
      };
    }

    return next as T;
  });
}

function parseSizedAlt(
  alt: string,
): { name: string; previewWidth: number; previewHeight?: number } | null {
  const pipe = /^(.*?)\|(\d+)(?:x(\d+))?$/.exec(alt);
  if (pipe) {
    return sizedAlt((pipe[1] ?? "").trim(), pipe[2], pipe[3]);
  }

  const only = /^(\d+)(?:x(\d+))?$/.exec(alt.trim());
  if (only) return sizedAlt("", only[1], only[2]);

  return null;
}

function sizedAlt(
  name: string,
  widthRaw: string | undefined,
  heightRaw: string | undefined,
): { name: string; previewWidth: number; previewHeight?: number } | null {
  const previewWidth = Number(widthRaw);
  if (!Number.isFinite(previewWidth) || previewWidth <= 0) return null;
  const previewHeight = positivePx(heightRaw);
  return previewHeight
    ? { name, previewWidth, previewHeight }
    : { name, previewWidth };
}

/** Positive pixel length from an attribute or the height half of `320x180`. */
export function positivePx(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function formatSizedMarkdownImage(
  alt: string,
  src: string,
  width: number,
  height?: number,
): string {
  const trimmed = alt.trim();
  // If alt still has a stale |width from a partial restore, strip it.
  const cleaned = trimmed.replace(/\|(\d+)(?:x\d+)?$/, "").trim();
  const size = height ? `${width}x${height}` : `${width}`;
  if (!cleaned) return `![${size}](${src})`;
  return `![${cleaned}|${size}](${src})`;
}

function injectImgSize(imgTag: string, width: number, height?: number): string {
  let next = setImgAttr(imgTag, "width", width);
  if (height) next = setImgAttr(next, "height", height);
  return next;
}

function setImgAttr(imgTag: string, name: string, value: number): string {
  const attr = new RegExp(
    `\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\d+)`,
    "i",
  );
  if (attr.test(imgTag)) {
    return imgTag.replace(attr, `${name}="${value}"`);
  }
  return imgTag.replace(/^<img\b/i, `<img ${name}="${value}"`);
}

type ImageHit = {
  start: number;
  end: number;
  kind: "md" | "img";
  text: string;
  alt: string;
  src: string;
};

function findNextImageRef(
  markdown: string,
  url: string,
  from: number,
): ImageHit | null {
  const slice = markdown.slice(from);
  const mdRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
  const imgRe = /<img\b[^>]*>/gi;

  let best: ImageHit | null = null;

  for (const match of slice.matchAll(mdRe)) {
    const src = match[2] ?? "";
    if (!urlsMatch(src, url)) continue;
    const start = from + (match.index ?? 0);
    best = {
      start,
      end: start + match[0].length,
      kind: "md",
      text: match[0],
      alt: match[1] ?? "",
      src,
    };
    break;
  }

  for (const match of slice.matchAll(imgRe)) {
    const tag = match[0];
    const src = imgSrcAttr(tag);
    if (!src || !urlsMatch(src, url)) continue;
    const start = from + (match.index ?? 0);
    if (best && start >= best.start) break;
    best = {
      start,
      end: start + tag.length,
      kind: "img",
      text: tag,
      alt: imgAltAttr(tag),
      src,
    };
    break;
  }

  return best;
}

function imgSrcAttr(tag: string): string {
  const m = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return m?.[1] ?? m?.[2] ?? m?.[3] ?? "";
}

function imgAltAttr(tag: string): string {
  const m = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return m?.[1] ?? m?.[2] ?? m?.[3] ?? "";
}

function urlsMatch(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}

function normalizeUrl(url: string): string {
  try {
    return decodeURIComponent(url.trim());
  } catch {
    return url.trim();
  }
}
