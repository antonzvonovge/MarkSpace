import { generateText } from "ai";
import {
  hasCredentialsForModel,
  missingCredentialsMessage,
  resolveLanguageModel,
  type AiProviderCredentials,
} from "./languageModel";

/** Cheap model for dictionary entry fill — same class as link suggest. */
const SUGGEST_MODEL = "openai/gpt-4.1-mini";

export type SuggestDictEntryResult = {
  transcript: string;
  translation: string;
  examples: string[];
};

export type SuggestDictEntryParams = {
  word: string;
  /** ISO code or empty when unknown. */
  learningLanguageCode?: string;
  learningLanguageLabel?: string;
  nativeLanguageCode: string;
  nativeLanguageLabel: string;
  keys: AiProviderCredentials;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
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

function normalizeExamples(raw: unknown): string[] {
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
    if (out.length >= 4) break;
  }
  return out;
}

function buildSystem(params: SuggestDictEntryParams): string {
  const learn =
    params.learningLanguageLabel?.trim() ||
    params.learningLanguageCode?.trim() ||
    "the target language of the vocabulary list";
  const native = `${params.nativeLanguageLabel} (${params.nativeLanguageCode})`;
  return `You help fill a vocabulary dictionary entry for a language-learning notes app.
The entry may be a single word or a multi-word expression / phrase / idiom.
Reply with JSON only, no markdown fences:
{"transcript":"...","translation":"...","examples":["...","..."]}

- The entry text is in ${learn}.
- transcript: pronunciation aid for the whole entry (IPA when appropriate for the language; otherwise a clear phonetic spelling). For multi-word expressions, cover the full phrase. Single line. Empty string if truly unknown.
- translation: gloss into the learner's native language ${native}. Single line, concise; for idioms prefer the natural equivalent, not a word-by-word calque.
- examples: 1–3 short usage sentences in ${learn} that naturally include the entry (or a natural inflection of it). No translations of the examples.
- Do not invent tags. Do not wrap values in extra quotes beyond JSON.
- Keep examples short (under ~120 chars each).`;
}

export async function suggestDictEntry(
  params: SuggestDictEntryParams,
): Promise<SuggestDictEntryResult> {
  const word = params.word.trim();
  if (!word) throw new Error("Word or expression is required");

  const canSuggest =
    hasCredentialsForModel(SUGGEST_MODEL, params.keys) ||
    (!!params.fallbackModelId?.trim() &&
      hasCredentialsForModel(params.fallbackModelId, params.keys));
  if (!canSuggest) {
    throw new Error(
      missingCredentialsMessage(
        params.fallbackModelId?.trim() || SUGGEST_MODEL,
        params.keys,
      ),
    );
  }

  const prompt = `Entry (word or expression): ${word}`;

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
      maxOutputTokens: 400,
      temperature: 0.3,
      abortSignal: params.abortSignal,
    });
    const parsed = extractJsonObject(text) as {
      transcript?: unknown;
      translation?: unknown;
      examples?: unknown;
    };
    return {
      transcript: normalizeLine(parsed.transcript),
      translation: normalizeLine(parsed.translation),
      examples: normalizeExamples(parsed.examples),
    };
  };

  if (hasCredentialsForModel(SUGGEST_MODEL, params.keys)) {
    try {
      return await tryModel(SUGGEST_MODEL);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      const fallback = params.fallbackModelId?.trim();
      if (fallback && fallback !== SUGGEST_MODEL) {
        return await tryModel(fallback);
      }
      throw e;
    }
  }

  const fallback = params.fallbackModelId?.trim();
  if (!fallback) {
    throw new Error(missingCredentialsMessage(SUGGEST_MODEL, params.keys));
  }
  return await tryModel(fallback);
}
