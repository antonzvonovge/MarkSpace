export type DialogueLine = {
  speaker?: string;
  text: string;
};

export type DialogueTurn = {
  speaker: string;
  text: string;
  voiceIndex: number;
};

/** Consecutive lines from the same speaker become one clip; each speaker gets a stable voice. */
export function groupDialogueTurns(lines: DialogueLine[]): DialogueTurn[] {
  const voiceBySpeaker = new Map<string, number>();
  const turns: DialogueTurn[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const speaker = line.speaker?.trim() || "Speaker";
    if (!voiceBySpeaker.has(speaker)) {
      voiceBySpeaker.set(speaker, voiceBySpeaker.size);
    }
    const voiceIndex = voiceBySpeaker.get(speaker)!;
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${text}`;
    } else {
      turns.push({ speaker, text, voiceIndex });
    }
  }
  return turns;
}

const SPELL_LETTERS =
  /(?:[A-Za-z](?:\s*[-–—.]\s*|\s+)){2,}[A-Za-z](?:\.|(?=\s|$|,|;))/g;
const SPELL_DIGITS =
  /(?:\d(?:\s*[-–—.]\s*|\s+)){2,}\d/g;

function spacedLetters(raw: string): string {
  const letters = raw.match(/[A-Za-z]/g);
  if (!letters || letters.length < 3) return raw;
  return letters.map((L) => `${L.toUpperCase()},`).join(" ... ");
}

function spacedDigits(raw: string): string {
  const digits = raw.match(/\d/g);
  if (!digits || digits.length < 3) return raw;
  return digits.map((d) => `${d},`).join(" ... ");
}

/**
 * Stretch letter-by-letter / digit spelling so TTS does not rush "B-E-N-N-E-T-T".
 * `slow` tells the TTS layer to drop speed for that clip.
 */
export function expandIeltsTtsText(text: string): { text: string; slow: boolean } {
  let slow = false;
  let out = text.replace(SPELL_LETTERS, (raw) => {
    const next = spacedLetters(raw);
    if (next !== raw) slow = true;
    return next;
  });
  out = out.replace(SPELL_DIGITS, (raw) => {
    const next = spacedDigits(raw);
    if (next !== raw) slow = true;
    return next;
  });
  return { text: out, slow };
}

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** ASCII punctuation so Azure SSML does not 400 on curly quotes. */
export function normalizeIeltsTtsText(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ");
}

function wrapSsmlSpelling(text: string): string {
  const source = normalizeIeltsTtsText(text);
  const letterRe = new RegExp(SPELL_LETTERS.source, "g");
  const digitRe = new RegExp(SPELL_DIGITS.source, "g");
  const ranges: { start: number; end: number; kind: "letters" | "digits" }[] = [];
  for (const m of source.matchAll(letterRe)) {
    if (m.index == null) continue;
    ranges.push({ start: m.index, end: m.index + m[0].length, kind: "letters" });
  }
  for (const m of source.matchAll(digitRe)) {
    if (m.index == null) continue;
    ranges.push({ start: m.index, end: m.index + m[0].length, kind: "digits" });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r.start < prev.end) continue;
    merged.push(r);
  }
  let out = "";
  let last = 0;
  for (const r of merged) {
    out += xmlEscape(source.slice(last, r.start));
    const chunk = source.slice(r.start, r.end);
    if (r.kind === "letters") {
      const letters = (chunk.match(/[A-Za-z]/g) ?? []).join("").toUpperCase();
      out += `<say-as interpret-as="characters">${xmlEscape(letters)}</say-as>`;
    } else {
      const digits = (chunk.match(/\d/g) ?? []).join("");
      out += `<say-as interpret-as="digits">${xmlEscape(digits)}</say-as>`;
    }
    last = r.end;
  }
  out += xmlEscape(source.slice(last));
  return out;
}

const AZURE_GB_VOICES = ["en-GB-SoniaNeural", "en-GB-RyanNeural"] as const;

/** One SSML document for a GT dialogue (British voices, spelled names as letters). */
export function dialogueToAzureSsml(lines: DialogueLine[]): string {
  const turns = groupDialogueTurns(lines);
  const inner = turns
    .map((turn, i) => {
      const voice = AZURE_GB_VOICES[turn.voiceIndex % AZURE_GB_VOICES.length]!;
      const pause = i === 0 ? "" : `<break time="400ms"/>`;
      return `<voice name="${voice}">${pause}<prosody rate="-5%">${wrapSsmlSpelling(turn.text)}</prosody></voice>`;
    })
    .join("");
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB">${inner}</speak>`;
}

export function utteranceToAzureSsml(text: string, voiceIndex = 0): string {
  const voice = AZURE_GB_VOICES[Math.max(0, voiceIndex) % AZURE_GB_VOICES.length]!;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><voice name="${voice}"><prosody rate="-5%">${wrapSsmlSpelling(text)}</prosody></voice></speak>`;
}

/** Join same-encoder MP3 clips into one playable file (frame concat). */
export function concatMp3Buffers(parts: Uint8Array[]): Uint8Array {
  const usable = parts.filter((p) => p.byteLength > 0);
  if (usable.length === 0) return new Uint8Array(0);
  if (usable.length === 1) return usable[0]!;
  const total = usable.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of usable) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Vault-relative folder; chat project is ignored. */
export function resolveIeltsFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, "");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local `22.08.2026-14.05` (dots so the name is valid on Windows). */
function formatIeltsSessionStamp(d: Date): string {
  const day = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  const time = `${pad2(d.getHours())}.${pad2(d.getMinutes())}`;
  return `${day}-${time}`;
}

const DATED_STEM_PREFIX =
  /^\d{2}\.\d{2}\.\d{4}(?:-\d{2}\.\d{2})?-?/;

/** Session note stem: `22.08.2026-14.05-listening-section-1`. */
export function ieltsSessionFileStem(
  variant: string,
  now: Date = new Date(),
): string {
  const stamp = formatIeltsSessionStamp(now);
  const raw = variant.trim().replace(/\.md$/i, "");
  const withoutDate = raw.replace(DATED_STEM_PREFIX, "");
  const slug = withoutDate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug ? `${stamp}-${slug}` : stamp;
}

const SESSION_BUNDLE_DIR_RE = /^\d{2}\.\d{2}\.\d{4}-.+/;

/** Listening (note + audio) lives in `{parent}/{dd.MM.YYYY-HH.mm-topic}/`. */
export function nestIeltsBundleFolder(parent: string, stem: string): string {
  const p = parent.replace(/^\/+|\/+$/g, "");
  const last = p.split("/").pop() ?? "";
  if (SESSION_BUNDLE_DIR_RE.test(last)) return p;
  const s = stem.replace(/\.md$/i, "").replace(/^\/+|\/+$/g, "");
  if (!s) return p;
  return p ? `${p}/${s}` : s;
}

export function ieltsSkillNeedsBundleFolder(skill: string | undefined): boolean {
  return skill === "listening";
}

const SESSION_NOTE_RE =
  /^(\d{2}\.\d{2}\.\d{4})(?:-\d{2}\.\d{2})?-(.+)\.md$/i;

/** Topic slug from `22.08.2026-14.05-section-1-community-centre-booking.md`. */
export function topicFromSessionFilename(filename: string): string | null {
  const m = filename.trim().split(/[/\\]/).pop()?.match(SESSION_NOTE_RE);
  return m?.[2]?.trim() || null;
}

/** Unique topic slugs from session note names (so the model can rotate themes). */
export function topicsFromSessionFilenames(filenames: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of filenames) {
    const topic = topicFromSessionFilename(name);
    if (!topic) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
  }
  return out;
}
