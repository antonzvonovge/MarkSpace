import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { normalizeDayMarkerId } from "./dayMarkers";

export type FrontmatterData = Record<string, unknown>;

export type SplitFrontmatter = {
  /** Parsed YAML object, or null when there is no frontmatter fence / YAML failed. */
  data: FrontmatterData | null;
  /** Markdown body after the closing `---` (may be empty). */
  body: string;
  /** True when a leading `---`…`---` fence was present (even if YAML failed). */
  hasFence: boolean;
  /** Raw YAML between fences; set whenever hasFence is true. */
  rawYaml: string | null;
};

const FENCE = "---";

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Split a note into YAML frontmatter and markdown body. */
export function splitFrontmatter(markdown: string): SplitFrontmatter {
  const text = stripBom(markdown);
  if (!text.startsWith(`${FENCE}\n`) && !text.startsWith(`${FENCE}\r\n`)) {
    return { data: null, body: text, hasFence: false, rawYaml: null };
  }

  const afterOpen = text.startsWith(`${FENCE}\r\n`) ? 5 : 4;
  const rest = text.slice(afterOpen);
  const closeMatch = rest.match(/\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    return { data: null, body: text, hasFence: false, rawYaml: null };
  }

  const yamlText = rest.slice(0, closeMatch.index);
  const bodyStart = closeMatch.index + closeMatch[0].length;
  const body = rest.slice(bodyStart);

  try {
    const parsed = parseYaml(yamlText);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: {}, body, hasFence: true, rawYaml: yamlText };
    }
    return {
      data: parsed as FrontmatterData,
      body,
      hasFence: true,
      rawYaml: yamlText,
    };
  } catch {
    // Keep fence semantics for Live strip, but no structured data to rewrite.
    return { data: null, body, hasFence: true, rawYaml: yamlText };
  }
}

function normalizeTagName(raw: string): string | null {
  let t = raw.trim();
  if (!t) return null;
  if (t.startsWith("#")) t = t.slice(1).trim();
  if (!t) return null;
  return t;
}

/** Normalize any tags value from YAML into a deduped string list. */
export function normalizeTags(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: unknown) => {
    // Tolerate mapping items (`- name: work`) written by other tools.
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      push(record.name ?? record.tag ?? record.title);
      return;
    }
    if (typeof raw !== "string" && typeof raw !== "number") return;
    const name = normalizeTagName(String(raw));
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  if (value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) push(item);
    return out;
  }
  if (typeof value === "string") {
    // Support "a, b" and single tag.
    if (value.includes(",")) {
      for (const part of value.split(",")) push(part);
    } else {
      push(value);
    }
    return out;
  }
  push(value);
  return out;
}

export function getNoteTags(markdown: string): string[] {
  const { data } = splitFrontmatter(markdown);
  if (!data) return [];
  return normalizeTags(data.tags);
}

/** Diary day-marker catalog id from YAML `marker:`, or empty when unset/invalid. */
export function getNoteDayMarker(markdown: string): string {
  const { data } = splitFrontmatter(markdown);
  if (!data) return "";
  return normalizeDayMarkerId(data.marker);
}

/**
 * Return markdown with an updated `marker` id.
 * Preserves other frontmatter keys. Removes the fence when nothing remains.
 * When the existing fence has unparseable YAML, returns the original markdown
 * unchanged (UI cannot safely rewrite it).
 */
export function setNoteDayMarker(markdown: string, markerId: string): string {
  const split = splitFrontmatter(markdown);
  const next = normalizeDayMarkerId(markerId);

  if (split.hasFence && split.data === null) {
    return markdown;
  }

  const data: FrontmatterData = { ...(split.data ?? {}) };
  if (!next) {
    delete data.marker;
  } else {
    data.marker = next;
  }

  if (Object.keys(data).length === 0) {
    return split.body;
  }
  return mergeFrontmatter(data, split.body);
}

function formatFrontmatterYaml(data: FrontmatterData): string {
  const yaml = stringifyYaml(data, {
    lineWidth: 0,
    defaultKeyType: "PLAIN",
    defaultStringType: "PLAIN",
  }).trimEnd();
  return `${FENCE}\n${yaml}\n${FENCE}\n`;
}

/**
 * Merge frontmatter data with a markdown body.
 * Omits the fence entirely when data is empty/null.
 */
export function mergeFrontmatter(
  data: FrontmatterData | null | undefined,
  body: string,
): string {
  if (!data || Object.keys(data).length === 0) {
    return body;
  }
  return `${formatFrontmatterYaml(data)}${body}`;
}

/**
 * Return markdown with an updated `tags` list.
 * Preserves other frontmatter keys. Removes the fence when nothing remains.
 * When the existing fence has unparseable YAML, returns the original markdown
 * unchanged (UI cannot safely rewrite it).
 */
export function setNoteTags(markdown: string, tags: string[]): string {
  const split = splitFrontmatter(markdown);
  const nextTags = normalizeTags(tags);

  if (split.hasFence && split.data === null) {
    return markdown;
  }

  const data: FrontmatterData = { ...(split.data ?? {}) };
  if (nextTags.length === 0) {
    delete data.tags;
  } else {
    data.tags = nextTags;
  }

  if (Object.keys(data).length === 0) {
    return split.body;
  }
  return mergeFrontmatter(data, split.body);
}

/**
 * Add note lifecycle timestamps to frontmatter.
 * `created` is written once; `updated` changes on every successful save.
 * Unparseable YAML is left untouched because it cannot be rewritten safely.
 */
export function stampNoteTimestamps(
  markdown: string,
  now: Date = new Date(),
): string {
  const split = splitFrontmatter(markdown);
  if (split.hasFence && split.data === null) {
    return markdown;
  }

  const timestamp = now.toISOString();
  const data: FrontmatterData = { ...(split.data ?? {}) };
  if (!Object.prototype.hasOwnProperty.call(data, "created")) {
    data.created = timestamp;
  }
  data.updated = timestamp;
  return mergeFrontmatter(data, split.body);
}

/** Body only — for Live BlockNote. Keeps unparseable-fence body when present. */
export function noteBody(markdown: string): string {
  return splitFrontmatter(markdown).body;
}

/**
 * Replace the markdown body while preserving frontmatter from `markdown`.
 * Unparseable fences are reattached as raw YAML.
 */
export function withNoteBody(markdown: string, nextBody: string): string {
  const split = splitFrontmatter(markdown);
  if (!split.hasFence) return nextBody;
  if (split.data !== null) {
    return mergeFrontmatter(split.data, nextBody);
  }
  return `${FENCE}\n${split.rawYaml ?? ""}\n${FENCE}\n${nextBody}`;
}
