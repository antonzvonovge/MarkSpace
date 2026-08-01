/** On-disk format for MarkSpace `.mdlnks` link collection files. */

export const MDLNKS_HEADER = "# MarkSpace links v1";

export type MdlnksItem = {
  url: string;
  description: string;
  tags: string[];
};

export type MdlnksDoc = {
  filter: string[];
  items: MdlnksItem[];
};

export const EMPTY_MDLNKS = `${MDLNKS_HEADER}\n`;

function splitCsv(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function joinCsv(tags: string[]): string {
  return tags.map((t) => t.trim()).filter(Boolean).join(", ");
}

function looksLikeUrl(line: string): boolean {
  return /^(https?:\/\/|mailto:|file:\/\/|ftp:\/\/)/i.test(line);
}

/** Parse a `.mdlnks` document. Throws on invalid header. */
export function parseMdlnks(text: string): MdlnksDoc {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const first = (lines[0] ?? "").trim();
  if (first !== MDLNKS_HEADER) {
    throw new Error(`Invalid .mdlnks header (expected "${MDLNKS_HEADER}")`);
  }

  let i = 1;
  let filter: string[] = [];
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if (i < lines.length) {
    const m = /^filter:\s*(.*)$/i.exec(lines[i].trim());
    if (m) {
      filter = splitCsv(m[1] ?? "");
      i += 1;
    }
  }

  const items: MdlnksItem[] = [];
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i += 1;
    if (i >= lines.length) break;

    const urlLine = lines[i].trim();
    if (!looksLikeUrl(urlLine)) {
      throw new Error(`Expected URL at line ${i + 1}, got: ${urlLine}`);
    }
    i += 1;

    let description = "";
    let tags: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const line = lines[i].trim();
      const desc = /^description:\s*(.*)$/i.exec(line);
      if (desc) {
        description = (desc[1] ?? "").trim();
        i += 1;
        continue;
      }
      const tagLine = /^tags:\s*(.*)$/i.exec(line);
      if (tagLine) {
        tags = splitCsv(tagLine[1] ?? "");
        i += 1;
        continue;
      }
      throw new Error(`Unexpected line in link entry at ${i + 1}: ${line}`);
    }
    items.push({ url: urlLine, description, tags });
  }

  return { filter, items };
}

/** Serialize a links document. Always ends with a trailing newline. */
export function serializeMdlnks(doc: MdlnksDoc): string {
  const parts: string[] = [MDLNKS_HEADER];
  if (doc.filter.length > 0) {
    parts.push(`filter: ${joinCsv(doc.filter)}`);
  }
  parts.push("");

  for (const item of doc.items) {
    parts.push(item.url.trim());
    const desc = item.description.trim();
    if (desc) parts.push(`description: ${desc}`);
    if (item.tags.length > 0) parts.push(`tags: ${joinCsv(item.tags)}`);
    parts.push("");
  }

  return parts.join("\n");
}

/** Items that match every tag in `filter` (AND). Empty filter = all items. */
export function filterMdlnksItems(
  items: MdlnksItem[],
  filter: string[],
): MdlnksItem[] {
  if (filter.length === 0) return items;
  const need = filter.map((t) => t.toLowerCase());
  return items.filter((item) => {
    const have = new Set(item.tags.map((t) => t.toLowerCase()));
    return need.every((t) => have.has(t));
  });
}

/** Unique tags across items, case-preserved by first occurrence. */
export function collectMdlnksTags(items: MdlnksItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    for (const tag of item.tags) {
      const t = tag.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
