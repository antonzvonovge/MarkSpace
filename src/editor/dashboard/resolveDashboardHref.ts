import { isAbsoluteFsPath } from "../../lib/vaultApi";

/** Same scheme as chat note links; allowed through react-markdown urlTransform. */
export const DASHBOARD_NOTE_SCHEME = "markspace-note:";

export type DashboardHrefAction =
  | { action: "browser"; url: string }
  | { action: "open"; path: string }
  | { action: "wiki"; target: string }
  | { action: "none" };

export function dirnameFs(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  if (i < 0) return "";
  if (i === 0) return "/";
  const head = normalized.slice(0, i);
  // Keep "C:" as "C:/" so join stays absolute on Windows.
  if (/^[A-Za-z]:$/.test(head)) return `${head}/`;
  return head;
}

/** Join relative segments onto an absolute or vault-relative directory. */
export function joinPathSegments(baseDir: string, rel: string): string {
  const base = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const relNorm = rel.replace(/\\/g, "/");
  const baseParts =
    base === "" || base === "/"
      ? base === "/"
        ? [""]
        : []
      : base.split("/");
  const parts = [...baseParts, ...relNorm.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" && out.length === 0) {
      out.push("");
      continue;
    }
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "") out.pop();
      continue;
    }
    out.push(part);
  }
  if (out.length === 1 && out[0] === "") return "/";
  // Windows drive root: ["C:", "foo"] → "C:/foo"
  if (out.length >= 1 && /^[A-Za-z]:$/.test(out[0]!)) {
    return `${out[0]}/${out.slice(1).join("/")}`;
  }
  return out.join("/");
}

export function parseFileUrl(href: string): string | null {
  if (!/^file:/i.test(href)) return null;
  try {
    const url = new URL(href);
    let path = decodeURIComponent(url.pathname);
    // Chromium-style file:///C:/Users/... → pathname "/C:/Users/..."
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    return path;
  } catch {
    return null;
  }
}

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

/** Append `.md` when the basename has no extension (job-style bare names). */
function ensureMarkdownPath(path: string): string {
  if (isMarkdownPath(path)) return path;
  const base = path.split(/[/\\]/).pop() ?? "";
  if (base.includes(".")) return path;
  return `${path}.md`;
}

/**
 * Classify a markdown/wiki href from dashboard content for open / browser / wiki resolve.
 * Relative paths are resolved against `sourcePath`'s directory.
 */
export function classifyDashboardHref(
  href: string,
  sourcePath: string,
): DashboardHrefAction {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return { action: "none" };

  if (trimmed.startsWith(DASHBOARD_NOTE_SCHEME)) {
    try {
      const target = decodeURIComponent(
        trimmed.slice(DASHBOARD_NOTE_SCHEME.length),
      ).trim();
      if (!target) return { action: "none" };
      if (isAbsoluteFsPath(target)) {
        return isMarkdownPath(target)
          ? { action: "open", path: target }
          : { action: "none" };
      }
      return { action: "wiki", target };
    } catch {
      return { action: "none" };
    }
  }

  if (trimmed.startsWith("wiki:")) {
    try {
      const target = decodeURIComponent(trimmed.slice("wiki:".length)).trim();
      return target ? { action: "wiki", target } : { action: "none" };
    } catch {
      return { action: "none" };
    }
  }

  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return { action: "browser", url: trimmed };
  }

  const filePath = parseFileUrl(trimmed);
  if (filePath) {
    return isMarkdownPath(filePath)
      ? { action: "open", path: filePath }
      : { action: "none" };
  }

  if (isAbsoluteFsPath(trimmed)) {
    const path = ensureMarkdownPath(trimmed);
    return isMarkdownPath(path) ? { action: "open", path } : { action: "none" };
  }

  const cleaned = trimmed.replace(/^\.\//, "");
  if (!sourcePath.trim()) {
    return { action: "wiki", target: cleaned.replace(/\.md$/i, "") };
  }

  if (isAbsoluteFsPath(sourcePath)) {
    const joined = ensureMarkdownPath(
      joinPathSegments(dirnameFs(sourcePath), cleaned),
    );
    return isMarkdownPath(joined)
      ? { action: "open", path: joined }
      : { action: "none" };
  }

  const vaultDir = dirnameFs(sourcePath.replace(/\\/g, "/"));
  const joined = joinPathSegments(vaultDir, cleaned);
  return { action: "wiki", target: joined.replace(/\.md$/i, "") };
}
