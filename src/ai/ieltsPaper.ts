import { z } from "zod";
import { createToolWait } from "./toolWait";

export type IeltsPaperKind = "gap" | "choice" | "long";

export type IeltsPaperOption = { id: string; label: string };

export type IeltsPaperQuestion = {
  id: string;
  n: string;
  kind: IeltsPaperKind;
  prompt: string;
  placeholder: string;
  heading: string;
  options: IeltsPaperOption[];
};

export type IeltsPaper = {
  title: string;
  intro: string;
  options: IeltsPaperOption[];
  questions: IeltsPaperQuestion[];
};

export type IeltsPaperAnswerItem = {
  questionId: string;
  n: string;
  value: string;
};

export type IeltsPaperAnswer = {
  answers: IeltsPaperAnswerItem[];
};

const paperWait = createToolWait<IeltsPaperAnswer>("Paper");

export function waitForIeltsPaper(
  toolCallId: string,
  signal?: AbortSignal,
): Promise<IeltsPaperAnswer> {
  return paperWait.wait(toolCallId, signal);
}

export function resolveIeltsPaper(
  toolCallId: string,
  answer: IeltsPaperAnswer,
): boolean {
  return paperWait.resolve(toolCallId, answer);
}

export function cancelIeltsPaper(toolCallId: string, reason?: string): boolean {
  return paperWait.cancel(toolCallId, reason);
}

export function cancelAllPendingIeltsPaper(reason?: string): void {
  paperWait.cancelAll(reason);
}

export function hasPendingIeltsPaper(toolCallId?: string): boolean {
  return paperWait.has(toolCallId);
}

const optionSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1),
});

const questionSchema = z.object({
  id: z.string().min(1).optional(),
  n: z.string().min(1).optional(),
  kind: z.enum(["gap", "choice", "long"]).optional(),
  prompt: z.string().min(1),
  placeholder: z.string().optional(),
  heading: z.string().optional(),
  options: z.array(optionSchema).max(12).optional(),
});

export const ieltsPaperFieldsSchema = z.object({
  title: z.string().optional(),
  intro: z.string().optional().describe("Passage, cue card, or exam instructions (English)"),
  options: z
    .array(optionSchema)
    .max(12)
    .optional()
    .describe("Shared bank for matching (A–G locations, etc.)"),
  questions: z
    .array(questionSchema)
    .max(40)
    .optional()
    .describe("Numbered items. Empty = display-only (speaking cue card)."),
});

function uniqueId(candidate: string, fallback: string, used: Set<string>): string {
  const base = candidate.trim() || fallback;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function normalizeOptions(
  raw: { id?: string; label: string }[] | undefined,
  used: Set<string>,
): IeltsPaperOption[] {
  if (!raw?.length) return [];
  return raw.map((o, i) => ({
    label: o.label,
    id: uniqueId(o.id?.trim() || letterId(i), letterId(i), used),
  }));
}

function letterId(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function normalizeIeltsPaper(
  raw: z.infer<typeof ieltsPaperFieldsSchema>,
): IeltsPaper {
  const bankUsed = new Set<string>();
  const options = normalizeOptions(raw.options, bankUsed);
  const usedQ = new Set<string>();
  const questions: IeltsPaperQuestion[] = (raw.questions ?? []).map((q, i) => {
    const n = (q.n ?? String(i + 1)).trim() || String(i + 1);
    const kind: IeltsPaperKind =
      q.kind ?? (q.options?.length || options.length ? "choice" : "gap");
    const localUsed = new Set<string>();
    const qOptions = q.options?.length
      ? normalizeOptions(q.options, localUsed)
      : kind === "choice"
        ? options
        : [];
    return {
      id: uniqueId(q.id ?? `q${n}`, `q${i + 1}`, usedQ),
      n,
      kind,
      prompt: q.prompt,
      placeholder: q.placeholder?.trim() || (kind === "gap" ? "Answer" : ""),
      heading: q.heading?.trim() || "",
      options: qOptions,
    };
  });
  return {
    title: raw.title?.trim() || "Questions",
    intro: raw.intro?.trim() || "",
    options,
    questions,
  };
}

export function parseIeltsPaperInput(input: unknown): IeltsPaper | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  if (rec.action !== "show_paper") return null;
  const parsed = ieltsPaperFieldsSchema.safeParse({
    title: rec.title,
    intro: rec.intro,
    options: rec.options,
    questions: rec.questions,
  });
  if (!parsed.success) return null;
  return normalizeIeltsPaper(parsed.data);
}

export function parseIeltsPaperOutput(output: unknown): IeltsPaperAnswer | null {
  if (!output || typeof output !== "object") return null;
  const answers = (output as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return null;
  const items: IeltsPaperAnswerItem[] = [];
  for (const raw of answers) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;
    if (typeof q.questionId !== "string") continue;
    items.push({
      questionId: q.questionId,
      n: typeof q.n === "string" ? q.n : "",
      value: typeof q.value === "string" ? q.value : "",
    });
  }
  return { answers: items };
}

/** Split a gap stem on blank markers so the UI can inject an input. */
export function splitGapPrompt(prompt: string): string[] {
  return prompt.split(/_{2,}|…{2,}|\.{3,}/);
}

export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}
