import { generateText } from "ai";
import type { MddictItem } from "../lib/mddictFormat";
import {
  isNativeLanguageId,
  nativeLanguageLabel,
  NATIVE_LANGUAGE_OPTIONS,
} from "../settings/types";
import {
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";
import { withFolderContext, type FolderAbout } from "../lib/folderContext";

/** Cheap model — same class as dictionary suggest / note title. */
/** Default foreign side of the pair (English ↔ native). */
export const DEFAULT_FOREIGN_LANG = "en";

export type QuickTranslateLang = string;

export type QuickTranslateExample = {
  text: string;
  translation: string;
  note: string;
};

export type QuickTranslateSense = {
  pos: string;
  meaning: string;
  register: string;
  usage: string;
  collocations: string[];
};

export type QuickTranslateResult = {
  query: string;
  queryLang: QuickTranslateLang;
  lemma: string;
  transcript: string;
  translation: string;
  translationTranscript: string;
  didYouMean: string;
  forms: string[];
  synonyms: string[];
  senses: QuickTranslateSense[];
  examples: QuickTranslateExample[];
};

export type QuickTranslateParams = {
  query: string;
  foreignLanguageCode: string;
  foreignLanguageLabel: string;
  nativeLanguageCode: string;
  nativeLanguageLabel: string;
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
  folderContext?: FolderAbout[];
};

export type QuickTranslatePair = {
  foreign: string;
  native: string;
};

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error("Model did not return JSON");
  }
}

function normalizeLine(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
}

function languageLabel(code: string): string {
  const c = code.trim();
  if (!c) return c;
  return isNativeLanguageId(c) ? nativeLanguageLabel(c) : c;
}

function normalizeLang(
  raw: unknown,
  pair: QuickTranslatePair,
): QuickTranslateLang {
  const v = normalizeLine(raw).toLowerCase();
  const foreign = pair.foreign.trim().toLowerCase() || DEFAULT_FOREIGN_LANG;
  const native = pair.native.trim().toLowerCase();
  if (!v) return foreign;
  if (v === native || v === languageLabel(native).toLowerCase()) return native;
  if (v === foreign || v === languageLabel(foreign).toLowerCase()) return foreign;
  for (const opt of NATIVE_LANGUAGE_OPTIONS) {
    if (v === opt.value || v === opt.label.toLowerCase()) return opt.value;
  }
  return foreign;
}

function normalizeStringList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const line = normalizeLine(item);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeSynonyms(
  raw: unknown,
  ...exclude: string[]
): string[] {
  const skip = new Set(
    exclude.map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  return normalizeStringList(raw, 6).filter(
    (item) => !skip.has(item.toLowerCase()),
  );
}

function normalizeExamples(raw: unknown): QuickTranslateExample[] {
  if (!Array.isArray(raw)) return [];
  const out: QuickTranslateExample[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      text?: unknown;
      translation?: unknown;
      note?: unknown;
    };
    const text = normalizeLine(rec.text);
    const translation = normalizeLine(rec.translation);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const note = normalizeLine(rec.note);
    out.push({ text, translation, note });
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeSenses(raw: unknown): QuickTranslateSense[] {
  if (!Array.isArray(raw)) return [];
  const out: QuickTranslateSense[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      pos?: unknown;
      meaning?: unknown;
      register?: unknown;
      usage?: unknown;
      collocations?: unknown;
    };
    const pos = normalizeLine(rec.pos);
    const meaning = normalizeLine(rec.meaning);
    if (!pos && !meaning) continue;
    out.push({
      pos,
      meaning,
      register: normalizeLine(rec.register),
      usage: normalizeLine(rec.usage),
      collocations: normalizeStringList(rec.collocations, 6),
    });
    if (out.length >= 5) break;
  }
  return out;
}

export function parseQuickTranslateResponse(
  raw: string,
  query: string,
  pair: QuickTranslatePair = {
    foreign: DEFAULT_FOREIGN_LANG,
    native: "ru",
  },
): QuickTranslateResult {
  const parsed = extractJsonObject(raw) as {
    queryLang?: unknown;
    lemma?: unknown;
    transcript?: unknown;
    translation?: unknown;
    translationTranscript?: unknown;
    didYouMean?: unknown;
    forms?: unknown;
    synonyms?: unknown;
    senses?: unknown;
    examples?: unknown;
  };
  const lemma = normalizeLine(parsed.lemma) || query.trim();
  const translation = normalizeLine(parsed.translation);
  if (!translation) throw new Error("Model did not return a translation");
  const didYouMean = normalizeLine(parsed.didYouMean);
  return {
    query: query.trim(),
    queryLang: normalizeLang(parsed.queryLang, pair),
    lemma,
    transcript: normalizeLine(parsed.transcript),
    translation,
    translationTranscript: normalizeLine(parsed.translationTranscript),
    didYouMean:
      didYouMean.toLowerCase() === query.trim().toLowerCase()
        ? ""
        : didYouMean,
    forms: normalizeStringList(parsed.forms, 8),
    synonyms: normalizeSynonyms(parsed.synonyms, translation, lemma),
    senses: normalizeSenses(parsed.senses),
    examples: normalizeExamples(parsed.examples),
  };
}

function buildSystem(params: QuickTranslateParams): string {
  const native = `${params.nativeLanguageLabel} (${params.nativeLanguageCode})`;
  const foreign = `${params.foreignLanguageLabel} (${params.foreignLanguageCode})`;
  const nativeCode = params.nativeLanguageCode.trim();
  const foreignCode = params.foreignLanguageCode.trim() || DEFAULT_FOREIGN_LANG;
  const body = `You are a bilingual ${params.foreignLanguageLabel} ↔ ${params.nativeLanguageLabel} dictionary for IELTS General Training (Writing Task 1 letters, Task 2 essays, Reading) in a notes app (user native language: ${native}).
The user types a word or short expression in ${foreign} or ${native} (detect which).
The head translation is in the OTHER language (inverse of the query). Learning aids — synonyms, inflections, collocations, and example sentences — are always in ${params.foreignLanguageLabel}, never in the user's native language. Sense explanations (meaning, usage) are in ${params.nativeLanguageLabel}.

Reply with JSON only, no markdown fences:
{"queryLang":"${foreignCode}"|"${nativeCode}","lemma":"...","transcript":"...","translation":"...","translationTranscript":"...","didYouMean":"...","forms":["..."],"synonyms":["..."],"senses":[{"pos":"...","meaning":"...","register":"...","usage":"...","collocations":["..."]}],"examples":[{"text":"...","translation":"...","note":"..."}]}

- queryLang: ISO code of the user's query (${foreignCode} or ${nativeCode}).
- lemma: citation form of the queried word, in queryLang. If the query is misspelled, lemma is the CORRECTED citation form you actually explain.
- transcript: pronunciation of the lemma. Empty if unknown.
- translation: citation form in the OTHER language (${params.foreignLanguageLabel} if queryLang is ${nativeCode}, ${params.nativeLanguageLabel} if queryLang is ${foreignCode}). For English verbs: infinitive without "to" (go). For other verbs: the usual dictionary citation form.
- translationTranscript: pronunciation of the translation. Empty if unknown.
- didYouMean: if the query has a spelling/typo (e.g. accomodation → accommodation, definately → definitely, shedule → schedule), put the corrected ${params.foreignLanguageLabel} spelling here. Empty string if the query is already correct. Do not copy the query into didYouMean when it is already right.

CRITICAL — never give ${params.nativeLanguageLabel} synonyms, inflections, collocations, or example sentences. The user already knows ${params.nativeLanguageLabel}.
- If queryLang is ${nativeCode}: forms = ${params.foreignLanguageLabel} inflections of the translation (English verbs: "goes · went · gone · going"; otherwise a compact paradigm). synonyms = close ${params.foreignLanguageLabel} synonyms of the translation. examples.text = ${params.foreignLanguageLabel} sentences that use the translation; examples.translation = ${params.nativeLanguageLabel} gloss.
- If queryLang is ${foreignCode}: forms = [] and translationTranscript = "". synonyms = close ${params.foreignLanguageLabel} synonyms of the lemma (the queried word), not of the ${params.nativeLanguageLabel} translation. examples.text = ${params.foreignLanguageLabel} sentences that use the lemma; examples.translation = ${params.nativeLanguageLabel} gloss.
- synonyms: 3–6 near-synonyms in ${params.foreignLanguageLabel}, citation form. Single words or short expressions. Do not repeat the lemma or the translation. Empty array if none are useful.
- senses: 1–4 entries for distinct parts of speech / meanings useful in IELTS General (letters, workplace, housing, travel, complaints, everyday life). pos = noun/verb/adjective/adverb/phrasal verb (English label). meaning = short ${params.nativeLanguageLabel} gloss of THIS sense (not just the head translation). register = Formal, Business, Informal, or Neutral. usage = one sentence in ${params.nativeLanguageLabel}: when to use this sense (e.g. formal letter to an employer vs informal letter to a friend). collocations = 2–5 ${params.foreignLanguageLabel} chunks (e.g. "make an arrangement", "meet a requirement").
- examples: 2–3 short ${params.foreignLanguageLabel} sentences in realistic IELTS General topics (complaint letter, job application, landlord, workplace, travel). Keep each text under ~120 chars. examples.note = brief ${params.nativeLanguageLabel} hint of the exam context (e.g. "Task 1: letter to landlord"). Empty forms array if not useful.

- Do not wrap values in extra quotes beyond JSON.`;
  return withFolderContext(body, params.folderContext ?? []);
}

export async function quickTranslate(
  params: QuickTranslateParams,
): Promise<QuickTranslateResult> {
  const query = params.query.trim();
  if (!query) throw new Error("Word or expression is required");

  const prompt = `Query: ${query}`;

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: buildSystem(params),
      prompt,
      maxOutputTokens: 2200,
      temperature: 0.3,
      abortSignal: params.abortSignal,
    });
    return parseQuickTranslateResponse(text, query, {
      foreign: params.foreignLanguageCode,
      native: params.nativeLanguageCode,
    });
  };

  return await runWithModelFallback({
    keys: params.keys,
    modelId: params.modelId,
    fallbackModelId: params.fallbackModelId,
    run: tryModel,
  });
}

/** Headword language for .mddict: the foreign side of the pair. */
export function dictHeadwordLang(
  nativeLanguageCode: string,
  foreignLanguageCode = DEFAULT_FOREIGN_LANG,
): QuickTranslateLang {
  const native = nativeLanguageCode.trim().toLowerCase();
  const foreign =
    foreignLanguageCode.trim().toLowerCase() || DEFAULT_FOREIGN_LANG;
  if (foreign === native) return native === "en" ? "ru" : DEFAULT_FOREIGN_LANG;
  return foreign;
}

/** Unique learning-language codes from language-learning projects, excluding native. */
export function collectLearningLanguageCodes(
  projects: Record<
    string,
    { projectType?: string; learningLanguage?: string }
  >,
  nativeLanguageCode: string,
): string[] {
  const native = nativeLanguageCode.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const props of Object.values(projects)) {
    if (props.projectType !== "languageLearning") continue;
    const code = (props.learningLanguage ?? "").trim().toLowerCase();
    if (!code || code === native || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  out.sort((a, b) => languageLabel(a).localeCompare(languageLabel(b)));
  return out;
}

/** Dropdown values: English first (when it isn't native), then project languages. */
export function quickTranslatePairCodes(
  learningLanguageCodes: string[],
  nativeLanguageCode: string,
): string[] {
  const native = nativeLanguageCode.trim().toLowerCase();
  const codes: string[] = [];
  const add = (raw: string) => {
    const code = raw.trim().toLowerCase();
    if (!code || code === native || codes.includes(code)) return;
    codes.push(code);
  };
  add(DEFAULT_FOREIGN_LANG);
  for (const code of learningLanguageCodes) add(code);
  return codes;
}

export function quickTranslatePairLabel(
  foreignLanguageCode: string,
  nativeLanguageCode: string,
): string {
  return `${languageLabel(foreignLanguageCode)} ↔ ${languageLabel(nativeLanguageCode)}`;
}

/** The other-language side of the card (inverse of the query). */
export function quickTranslateTargetHead(result: QuickTranslateResult): {
  word: string;
  transcript: string;
  gloss: string;
} {
  return {
    word: result.translation.trim(),
    transcript: result.translationTranscript.trim(),
    gloss: result.lemma.trim() || result.query.trim(),
  };
}

export function otherTranslateLang(
  queryLang: QuickTranslateLang,
  foreignLanguageCode: string,
  nativeLanguageCode: string,
): QuickTranslateLang {
  const q = queryLang.trim().toLowerCase();
  const native = nativeLanguageCode.trim().toLowerCase();
  const foreign =
    foreignLanguageCode.trim().toLowerCase() || DEFAULT_FOREIGN_LANG;
  return q === native ? foreign : native;
}

/** Forms are for the foreign word, not a translation into the native language. */
export function quickTranslateShowForms(
  result: QuickTranslateResult,
  nativeLanguageCode: string,
): boolean {
  return (
    result.queryLang.trim().toLowerCase() ===
    nativeLanguageCode.trim().toLowerCase()
  );
}

export function dictItemFromQuickTranslate(
  result: QuickTranslateResult,
  nativeLanguageCode: string,
  foreignLanguageCode = DEFAULT_FOREIGN_LANG,
): MddictItem {
  const headLang = dictHeadwordLang(nativeLanguageCode, foreignLanguageCode);
  const queryIsHead = result.queryLang === headLang;
  const word = queryIsHead
    ? result.lemma.trim() || result.query.trim()
    : result.translation.trim();
  const translation = queryIsHead
    ? result.translation.trim()
    : result.lemma.trim() || result.query.trim();
  const transcript = queryIsHead
    ? result.transcript.trim()
    : result.translationTranscript.trim();
  const examples = result.examples
    .map((ex) => (queryIsHead ? ex.translation : ex.text).trim())
    .filter(Boolean);
  return {
    word,
    transcript,
    translation,
    examples,
    tags: [],
    known: false,
  };
}

export function formatQuickTranslateMarkdown(
  result: QuickTranslateResult,
  nativeLanguageCode?: string,
): string {
  const { word, transcript } = quickTranslateTargetHead(result);
  const showLearningAids =
    nativeLanguageCode == null ||
    quickTranslateShowForms(result, nativeLanguageCode);
  const head =
    showLearningAids && transcript ? `${word} ${transcript}` : word;
  const lines: string[] = [];
  if (result.didYouMean) {
    lines.push(`Did you mean: ${result.didYouMean}`);
  }
  lines.push(head);
  for (const sense of result.senses) {
    const title = [sense.pos, sense.meaning].filter(Boolean).join(" — ");
    if (title) lines.push(title);
    const meta = [sense.register, sense.usage].filter(Boolean).join(". ");
    if (meta) lines.push(meta);
    if (sense.collocations.length > 0) {
      lines.push(`Collocations: ${sense.collocations.join(", ")}`);
    }
  }
  if (showLearningAids && result.forms.length > 0) {
    lines.push(`Forms: ${result.forms.join(", ")}`);
  }
  for (const ex of result.examples) {
    const gloss = ex.translation
      ? `${ex.text} — ${ex.translation}`
      : ex.text;
    const withNote = ex.note ? `${gloss} (${ex.note})` : gloss;
    lines.push(`- ${withNote}`);
  }
  return lines.join("\n");
}
