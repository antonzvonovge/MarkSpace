import { folderPathFromFolderNote } from "./vaultApi";

const HEADING_RE = /^[ ]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/;

/** Tree / chip key: folder notes map to the parent folder. */
export function noteTitleIndexKey(path: string): string | null {
  const cleaned = path.trim().replace(/^\/+|\/+$/g, "");
  if (!cleaned) return null;
  const folder = folderPathFromFolderNote(cleaned);
  if (folder) return folder;
  return cleaned;
}

/** Markdown notes and folders can rename a heading instead of the file. */
export function canEditNoteTitle(path: string, isDir: boolean): boolean {
  if (!path) return false;
  if (isDir) return true;
  return path.toLowerCase().endsWith(".md");
}

function fenceMarker(trimmed: string): "`" | "~" | null {
  if (trimmed.length < 3) return null;
  const c = trimmed[0];
  if (c !== "`" && c !== "~") return null;
  let n = 0;
  while (n < trimmed.length && trimmed[n] === c) n += 1;
  return n >= 3 ? c : null;
}

function skipFrontmatter(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") return i + 1;
  }
  return lines.length;
}

function splitLines(markdown: string): string[] {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/** Line index and level of the first ATX heading outside frontmatter and fences. */
function locateFirstHeading(
  lines: string[],
): { index: number; level: string; text: string } | null {
  let i = skipFrontmatter(lines);
  let fence: "`" | "~" | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = fenceMarker(line.trimStart());
    if (marker) {
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence) continue;
    const match = HEADING_RE.exec(line);
    if (!match) continue;
    return { index: i, level: match[1]!, text: match[2]! };
  }
  return null;
}

/** Raw inner text of the first ATX heading, or null. */
export function firstAtxHeading(markdown: string): string | null {
  return locateFirstHeading(splitLines(markdown))?.text ?? null;
}

function stripWrapped(input: string, delim: string): string {
  let out = "";
  let rest = input;
  while (rest.length > 0) {
    const start = rest.indexOf(delim);
    if (start < 0) {
      out += rest;
      break;
    }
    const after = rest.slice(start + delim.length);
    const end = after.indexOf(delim);
    if (end > 0) {
      out += rest.slice(0, start);
      out += after.slice(0, end);
      rest = after.slice(end + delim.length);
      continue;
    }
    out += rest.slice(0, start + delim.length);
    rest = after;
  }
  return out;
}

/** Visible heading text: wiki alias, link label, and paired emphasis. */
export function stripInlineMarkdown(text: string): string {
  let s = text
    .replace(
      /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g,
      (_, target: string, alias?: string) =>
        (alias && alias.trim()) || target.trim(),
    )
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  for (const delim of ["**", "__", "~~", "`"]) {
    s = stripWrapped(s, delim);
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Stripped first heading, or null when the note has none. */
export function displayNoteTitle(markdown: string): string | null {
  const raw = firstAtxHeading(markdown);
  if (raw == null) return null;
  const stripped = stripInlineMarkdown(raw);
  return stripped || null;
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * Replace the first ATX heading's text, keeping its level.
 * Inserts `# title` after frontmatter when the note has no heading.
 */
export function replaceFirstHeading(markdown: string, nextTitle: string): string {
  const title = nextTitle.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const lines = splitLines(markdown);
  const found = locateFirstHeading(lines);
  if (found) {
    lines[found.index] = `${found.level} ${title}`;
    return withTrailingNewline(lines.join("\n"));
  }
  const at = skipFrontmatter(lines);
  const headingLine = `# ${title}`;
  const next = lines[at] ?? "";
  if (next.trim() === "") lines.splice(at, 0, headingLine);
  else lines.splice(at, 0, headingLine, "");
  return withTrailingNewline(lines.join("\n"));
}

export type TreeTitleLabel = {
  label: string;
  /** Title text: do not dim a trailing “extension”. */
  literal: boolean;
  /** Heading edit selects the whole field. */
  selectAll: boolean;
  /** Full vault path while a title is shown. */
  tooltip?: string;
};

export function treeRowTitleLabel(
  path: string,
  isDir: boolean,
  fileName: string,
  showNoteTitles: boolean,
  titles: Readonly<Record<string, string>>,
): TreeTitleLabel {
  if (!showNoteTitles) {
    return { label: fileName, literal: false, selectAll: false };
  }
  const heading = titles[path];
  const titleMode = canEditNoteTitle(path, isDir);
  if (heading) {
    return {
      label: heading,
      literal: true,
      selectAll: titleMode,
      tooltip: path,
    };
  }
  return { label: fileName, literal: false, selectAll: titleMode };
}
