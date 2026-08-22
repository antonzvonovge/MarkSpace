import type { QuickTranslateResult } from "../ai/quickTranslate";
import { readNote, writeNote } from "./vaultApi";

export const QUICK_TRANSLATE_CACHE_PATH = ".markspace/quick-translate.json";

export type QuickTranslateCacheFile = {
  version: 1;
  records: Record<string, QuickTranslateCacheRecord>;
  aliases: Record<string, string>;
};

export type QuickTranslateCacheRecord = {
  result: QuickTranslateResult;
  notePath?: string;
};

export function emptyQuickTranslateCache(): QuickTranslateCacheFile {
  return { version: 1, records: {}, aliases: {} };
}

export function normalizeTranslateSurface(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function translatePairKey(foreign: string, native: string): string {
  return `${foreign.trim().toLowerCase()}|${native.trim().toLowerCase()}`;
}

export function translateAliasKey(
  foreign: string,
  native: string,
  surface: string,
): string {
  return `${translatePairKey(foreign, native)}|${normalizeTranslateSurface(surface)}`;
}

export function recordIdForResult(
  foreign: string,
  native: string,
  result: QuickTranslateResult,
): string {
  const lemma =
    result.lemma.trim() || result.didYouMean.trim() || result.query.trim();
  return `${translatePairKey(foreign, native)}|${normalizeTranslateSurface(lemma)}`;
}

export function surfacesFromResult(result: QuickTranslateResult): string[] {
  const raw = [
    result.query,
    result.lemma,
    result.didYouMean,
    result.translation,
    ...result.forms,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const key = normalizeTranslateSurface(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

export function lookupCachedTranslation(
  file: QuickTranslateCacheFile,
  foreign: string,
  native: string,
  query: string,
): QuickTranslateCacheRecord | null {
  const alias = translateAliasKey(foreign, native, query);
  const id = file.aliases[alias];
  if (!id) return null;
  return file.records[id] ?? null;
}

export function upsertCachedTranslation(
  file: QuickTranslateCacheFile,
  foreign: string,
  native: string,
  result: QuickTranslateResult,
  notePath?: string,
): QuickTranslateCacheFile {
  const id = recordIdForResult(foreign, native, result);
  const prev = file.records[id];
  const records = {
    ...file.records,
    [id]: {
      result,
      notePath: notePath ?? prev?.notePath,
    },
  };
  const aliases = { ...file.aliases };
  for (const surface of surfacesFromResult(result)) {
    aliases[translateAliasKey(foreign, native, surface)] = id;
  }
  return { version: 1, records, aliases };
}

export function remapCachedNotePath(
  file: QuickTranslateCacheFile,
  from: string,
  to: string,
): QuickTranslateCacheFile {
  if (from === to) return file;
  const records = { ...file.records };
  let changed = false;
  for (const [id, rec] of Object.entries(records)) {
    if (rec.notePath === from) {
      records[id] = { ...rec, notePath: to };
      changed = true;
    }
  }
  return changed ? { ...file, records } : file;
}

export async function loadQuickTranslateCache(): Promise<QuickTranslateCacheFile> {
  try {
    const raw = await readNote(QUICK_TRANSLATE_CACHE_PATH);
    const parsed = JSON.parse(raw) as QuickTranslateCacheFile;
    if (parsed?.version !== 1 || !parsed.records || !parsed.aliases) {
      return emptyQuickTranslateCache();
    }
    return parsed;
  } catch {
    return emptyQuickTranslateCache();
  }
}

export async function saveQuickTranslateCache(
  file: QuickTranslateCacheFile,
): Promise<void> {
  await writeNote(QUICK_TRANSLATE_CACHE_PATH, `${JSON.stringify(file, null, 2)}\n`);
}
