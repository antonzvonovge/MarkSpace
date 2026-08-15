import { generateText } from "ai";
import {
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";

/** Cheap model — same class as single-entry dict suggest. */
const CHUNK_SIZE = 8;

export type DictGapFields = {
  word: string;
  transcript: string;
  translation: string;
  examples: string[];
};

export type FillDictGapsParams = {
  entries: DictGapFields[];
  learningLanguageCode?: string;
  learningLanguageLabel?: string;
  nativeLanguageCode: string;
  nativeLanguageLabel: string;
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Called after each successful chunk so the UI can persist partial results. */
  onChunk?: (filled: DictGapFields[]) => void;
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

export function missingDictFields(entry: DictGapFields): {
  transcript: boolean;
  translation: boolean;
  examples: boolean;
} {
  return {
    transcript: !entry.transcript.trim(),
    translation: !entry.translation.trim(),
    examples: entry.examples.map((e) => e.trim()).filter(Boolean).length === 0,
  };
}

export function entryNeedsGapFill(entry: DictGapFields): boolean {
  if (!entry.word.trim()) return false;
  const m = missingDictFields(entry);
  return m.transcript || m.translation || m.examples;
}

/** Keep existing non-empty fields; apply AI values only where empty. */
export function applyGapFill(
  entry: DictGapFields,
  fill: Pick<DictGapFields, "transcript" | "translation" | "examples">,
): DictGapFields {
  const m = missingDictFields(entry);
  return {
    word: entry.word,
    transcript: m.transcript ? fill.transcript : entry.transcript,
    translation: m.translation ? fill.translation : entry.translation,
    examples: m.examples ? fill.examples : entry.examples,
  };
}

function buildSystem(params: FillDictGapsParams): string {
  const learn =
    params.learningLanguageLabel?.trim() ||
    params.learningLanguageCode?.trim() ||
    "the target language of the vocabulary list";
  const native = `${params.nativeLanguageLabel} (${params.nativeLanguageCode})`;
  return `You complete missing fields in vocabulary dictionary entries for a language-learning notes app.
Each entry may be a single word or a multi-word expression / phrase / idiom.
Reply with JSON only, no markdown fences:
{"entries":[{"word":"...","transcript":"...","translation":"...","examples":["...","..."]}]}

- Entries are in ${learn}.
- translation glosses into the learner's native language ${native}.
- transcript: pronunciation aid for the whole entry (IPA when appropriate; otherwise a clear phonetic spelling). Single line.
- examples: 1–3 short usage sentences in ${learn} that naturally include the entry (or a natural inflection). No translations of the examples. Keep each under ~120 chars.
- For each entry, fill ONLY fields that are empty or missing in the input. If a field is already provided, copy it back unchanged.
- Use already-filled fields as context so new values stay consistent (sense, register, spelling).
- Return one object per input entry, same "word" values, same order.
- Do not invent tags. Do not wrap values in extra quotes beyond JSON.`;
}

function chunkPrompt(entries: DictGapFields[]): string {
  const payload = entries.map((e) => {
    const m = missingDictFields(e);
    return {
      word: e.word.trim(),
      transcript: m.transcript ? null : e.transcript.trim(),
      translation: m.translation ? null : e.translation.trim(),
      examples: m.examples
        ? null
        : e.examples.map((x) => x.trim()).filter(Boolean),
    };
  });
  return `Complete missing fields (null means fill):\n${JSON.stringify({ entries: payload }, null, 2)}`;
}

function parseChunkResult(
  text: string,
  input: DictGapFields[],
): DictGapFields[] {
  const parsed = extractJsonObject(text) as {
    entries?: unknown;
  };
  const list = Array.isArray(parsed.entries) ? parsed.entries : [];
  const byWord = new Map<string, DictGapFields>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      word?: unknown;
      transcript?: unknown;
      translation?: unknown;
      examples?: unknown;
    };
    const word = normalizeLine(row.word);
    if (!word) continue;
    byWord.set(word.toLowerCase(), {
      word,
      transcript: normalizeLine(row.transcript),
      translation: normalizeLine(row.translation),
      examples: normalizeExamples(row.examples),
    });
  }

  return input.map((entry) => {
    const fill = byWord.get(entry.word.trim().toLowerCase());
    if (!fill) return entry;
    return applyGapFill(entry, fill);
  });
}

/**
 * Fill empty transcript / translation / examples for entries that have a word.
 * Processes in chunks; calls onProgress after each chunk (and once at start with 0).
 */
export async function fillDictGaps(
  params: FillDictGapsParams,
): Promise<DictGapFields[]> {
  const todo = params.entries.filter(entryNeedsGapFill);
  if (todo.length === 0) return [];

  const total = todo.length;
  params.onProgress?.(0, total);

  const tryModel = async (modelId: string, chunk: DictGapFields[]) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: buildSystem(params),
      prompt: chunkPrompt(chunk),
      maxOutputTokens: Math.min(200 + chunk.length * 220, 2800),
      temperature: 0.3,
      abortSignal: params.abortSignal,
    });
    return parseChunkResult(text, chunk);
  };

  const runChunk = async (chunk: DictGapFields[]) => {
    return await runWithModelFallback({
      keys: params.keys,
      modelId: params.modelId,
      fallbackModelId: params.fallbackModelId,
      run: (modelId) => tryModel(modelId, chunk),
    });
  };

  const out: DictGapFields[] = [];
  for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
    if (params.abortSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const chunk = todo.slice(i, i + CHUNK_SIZE);
    const filled = await runChunk(chunk);
    out.push(...filled);
    params.onChunk?.(filled);
    params.onProgress?.(Math.min(i + chunk.length, total), total);
  }
  return out;
}
