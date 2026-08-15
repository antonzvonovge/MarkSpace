import { generateText } from "ai";
import {
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";

/** Cheap model — same class as dictionary suggest / note title. */
export const IELTS_REVIEW_MAX_CHARS = 8000;
const MAX_ISSUES = 7;
const MAX_RECOMMENDATIONS = 5;

export type IeltsCriterion = "cc" | "lr" | "gra";

export type IeltsReviewIssue = {
  criterion: IeltsCriterion;
  quote: string;
  problem: string;
  fix: string;
};

export type IeltsGeneralReviewResult = {
  text: string;
  cc: number;
  lr: number;
  gra: number;
  overall: number;
  issues: IeltsReviewIssue[];
  recommendations: string[];
  rewrite: string;
};

export type IeltsGeneralReviewParams = {
  text: string;
  nativeLanguageCode: string;
  nativeLanguageLabel: string;
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
};

export const IELTS_CRITERION_LABEL: Record<IeltsCriterion, string> = {
  cc: "CC",
  lr: "LR",
  gra: "GRA",
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

function normalizeMultiline(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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

/** Clamp to 0–9 and snap to a 0.5 IELTS step. */
export function normalizeIeltsBand(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error("Model did not return valid band scores");
  }
  const clamped = Math.min(9, Math.max(0, n));
  return Math.round(clamped * 2) / 2;
}

/**
 * IELTS overall rounding: nearest whole or half band;
 * averages ending in .25 or .75 round up (6.25 → 6.5, 6.75 → 7.0).
 */
export function roundIeltsOverall(cc: number, lr: number, gra: number): number {
  const mean = (cc + lr + gra) / 3;
  const floor = Math.floor(mean);
  const remainder = mean - floor;
  if (remainder < 0.25) return floor;
  if (remainder < 0.75) return floor + 0.5;
  return floor + 1;
}

export function formatIeltsBand(n: number): string {
  return n.toFixed(1);
}

function normalizeCriterion(raw: unknown): IeltsCriterion | null {
  const v = normalizeLine(raw).toLowerCase();
  if (v === "cc" || v === "coherence" || v === "cohesion") return "cc";
  if (v === "lr" || v === "lexical" || v === "lexical resource") return "lr";
  if (v === "gra" || v === "grammar" || v === "grammatical") return "gra";
  return null;
}

function normalizeIssues(raw: unknown): IeltsReviewIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: IeltsReviewIssue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      criterion?: unknown;
      quote?: unknown;
      problem?: unknown;
      fix?: unknown;
    };
    const criterion = normalizeCriterion(rec.criterion);
    const problem = normalizeLine(rec.problem);
    if (!criterion || !problem) continue;
    out.push({
      criterion,
      quote: normalizeLine(rec.quote),
      problem,
      fix: normalizeLine(rec.fix),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function parseIeltsGeneralReviewResponse(
  raw: string,
  text: string,
): IeltsGeneralReviewResult {
  const parsed = extractJsonObject(raw) as {
    cc?: unknown;
    lr?: unknown;
    gra?: unknown;
    issues?: unknown;
    recommendations?: unknown;
    rewrite?: unknown;
  };
  const cc = normalizeIeltsBand(parsed.cc);
  const lr = normalizeIeltsBand(parsed.lr);
  const gra = normalizeIeltsBand(parsed.gra);
  const rewrite = normalizeMultiline(parsed.rewrite);
  if (!rewrite) throw new Error("Model did not return a rewrite");
  return {
    text: text.trim(),
    cc,
    lr,
    gra,
    overall: roundIeltsOverall(cc, lr, gra),
    issues: normalizeIssues(parsed.issues),
    recommendations: normalizeStringList(
      parsed.recommendations,
      MAX_RECOMMENDATIONS,
    ),
    rewrite,
  };
}

function buildSystem(params: IeltsGeneralReviewParams): string {
  const native = `${params.nativeLanguageLabel} (${params.nativeLanguageCode})`;
  return `You are an IELTS General Training writing examiner for a notes app.
The user pastes an English fragment (a sentence, paragraph, letter, or Task 2 essay draft) — not necessarily a full task with a prompt.

Score ONLY three criteria, each 0–9 in 0.5 steps:
- cc: Coherence and Cohesion
- lr: Lexical Resource
- gra: Grammatical Range and Accuracy

Do NOT score Task Achievement or Task Response (there is no official prompt). Do not invent an overall band — the app computes it.
Do not inflate scores. Typical learner drafts sit around 5.0–7.0; 8.0+ needs rare, controlled, natural English.

This is General Training, not Academic:
- Task 1 may be informal / semi-formal / formal letters. Match the implied tone; do not demand Academic essay diction.
- Task 2 essays are slightly less formal than Academic, but still clear and organised. Flag Academic-only vocabulary stuffing.

Reply with JSON only, no markdown fences:
{"cc":6.0,"lr":6.5,"gra":6.0,"issues":[{"criterion":"gra","quote":"...","problem":"...","fix":"..."}],"recommendations":["..."],"rewrite":"..."}

- issues: up to 7. criterion is "cc" | "lr" | "gra". quote must be an exact substring of the user's English (empty if the issue is global). problem and fix are in ${native}. fix may include a short English rewrite of the quoted phrase.
- recommendations: 3–5 practical "how to do better" tips in ${native} (linkers, GT letter tone, vocabulary, typical Informal/Formal letter vs Task 2 traps).
- rewrite: polished English of the same meaning, IELTS General register. Preserve paragraph breaks. Do not add a heading or commentary.

Be strict about quotes: never fabricate text that is not in the input.
Do not wrap values in extra quotes beyond JSON.`;
}

export async function ieltsGeneralReview(
  params: IeltsGeneralReviewParams,
): Promise<IeltsGeneralReviewResult> {
  const text = params.text.trim().slice(0, IELTS_REVIEW_MAX_CHARS);
  if (!text) throw new Error("English text is required");

  const prompt = `English text to review:\n\n${text}`;

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text: raw } = await generateText({
      model: resolved.model,
      system: buildSystem(params),
      prompt,
      maxOutputTokens: 2000,
      temperature: 0.3,
      abortSignal: params.abortSignal,
    });
    return parseIeltsGeneralReviewResponse(raw, text);
  };

  return await runWithModelFallback({
    keys: params.keys,
    modelId: params.modelId,
    fallbackModelId: params.fallbackModelId,
    run: tryModel,
  });
}

export function formatIeltsGeneralReviewMarkdown(
  result: IeltsGeneralReviewResult,
): string {
  const bands = `**Overall ${formatIeltsBand(result.overall)}** · CC ${formatIeltsBand(result.cc)} · LR ${formatIeltsBand(result.lr)} · GRA ${formatIeltsBand(result.gra)}`;
  const lines: string[] = [
    "### IELTS General writing review (indicative)",
    "",
    bands,
  ];
  if (result.issues.length > 0) {
    lines.push("", "**Issues**");
    for (const issue of result.issues) {
      const label = IELTS_CRITERION_LABEL[issue.criterion];
      if (issue.quote) {
        lines.push(`- **${label}** — "${issue.quote}": ${issue.problem}`);
      } else {
        lines.push(`- **${label}** — ${issue.problem}`);
      }
      if (issue.fix) {
        lines.push(`  Fix: ${issue.fix}`);
      }
    }
  }
  if (result.recommendations.length > 0) {
    lines.push("", "**Recommendations**");
    for (const tip of result.recommendations) {
      lines.push(`- ${tip}`);
    }
  }
  lines.push("", "**Rewrite**", result.rewrite);
  return lines.join("\n");
}
