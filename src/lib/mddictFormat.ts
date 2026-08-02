/** On-disk format for MarkSpace `.mddict` dictionary files. */

export const MDDICT_HEADER = "# MarkSpace dictionary v1";

export type MddictItem = {
  word: string;
  transcript: string;
  translation: string;
  examples: string[];
  tags: string[];
};

export type MddictDoc = {
  filter: string[];
  items: MddictItem[];
};

export const EMPTY_MDDICT = `${MDDICT_HEADER}\n`;

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

function isMetaKey(line: string): boolean {
  return /^(transcript|translation|example|tags):/i.test(line);
}

/** Parse a `.mddict` document. Throws on invalid header. */
export function parseMddict(text: string): MddictDoc {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const first = (lines[0] ?? "").trim();
  if (first !== MDDICT_HEADER) {
    throw new Error(`Invalid .mddict header (expected "${MDDICT_HEADER}")`);
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

  const items: MddictItem[] = [];
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i += 1;
    if (i >= lines.length) break;

    const wordLine = lines[i].trim();
    if (!wordLine || isMetaKey(wordLine) || /^filter:/i.test(wordLine)) {
      throw new Error(`Expected word at line ${i + 1}, got: ${wordLine || "(empty)"}`);
    }
    i += 1;

    let transcript = "";
    let translation = "";
    const examples: string[] = [];
    let tags: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const line = lines[i].trim();
      const tr = /^transcript:\s*(.*)$/i.exec(line);
      if (tr) {
        transcript = (tr[1] ?? "").trim();
        i += 1;
        continue;
      }
      const tl = /^translation:\s*(.*)$/i.exec(line);
      if (tl) {
        translation = (tl[1] ?? "").trim();
        i += 1;
        continue;
      }
      const ex = /^example:\s*(.*)$/i.exec(line);
      if (ex) {
        const example = (ex[1] ?? "").trim();
        if (example) examples.push(example);
        i += 1;
        continue;
      }
      const tagLine = /^tags:\s*(.*)$/i.exec(line);
      if (tagLine) {
        tags = splitCsv(tagLine[1] ?? "");
        i += 1;
        continue;
      }
      throw new Error(`Unexpected line in dictionary entry at ${i + 1}: ${line}`);
    }
    items.push({ word: wordLine, transcript, translation, examples, tags });
  }

  return { filter, items };
}

/** Serialize a dictionary document. Always ends with a trailing newline. */
export function serializeMddict(doc: MddictDoc): string {
  const parts: string[] = [MDDICT_HEADER];
  if (doc.filter.length > 0) {
    parts.push(`filter: ${joinCsv(doc.filter)}`);
  }
  parts.push("");

  for (const item of doc.items) {
    const word = item.word.trim();
    if (!word) continue;
    parts.push(word);
    const transcript = item.transcript.trim();
    if (transcript) parts.push(`transcript: ${transcript}`);
    const translation = item.translation.trim();
    if (translation) parts.push(`translation: ${translation}`);
    for (const example of item.examples) {
      const ex = example.trim();
      if (ex) parts.push(`example: ${ex}`);
    }
    if (item.tags.length > 0) parts.push(`tags: ${joinCsv(item.tags)}`);
    parts.push("");
  }

  return parts.join("\n");
}

/** Items that match every tag in `filter` (AND). Empty filter = all items. */
export function filterMddictItems(
  items: MddictItem[],
  filter: string[],
): MddictItem[] {
  if (filter.length === 0) return items;
  const need = filter.map((t) => t.toLowerCase());
  return items.filter((item) => {
    const have = new Set(item.tags.map((t) => t.toLowerCase()));
    return need.every((t) => have.has(t));
  });
}

/** Unique tags across items, case-preserved by first occurrence. */
export function collectMddictTags(items: MddictItem[]): string[] {
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

/** Unique tags from filter + all items (for vault-wide bank merge). */
export function collectMddictDocTags(doc: MddictDoc): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const t of doc.filter) add(t);
  for (const t of collectMddictTags(doc.items)) add(t);
  return out;
}

export function emptyMddictItem(): MddictItem {
  return {
    word: "",
    transcript: "",
    translation: "",
    examples: [],
    tags: [],
  };
}
