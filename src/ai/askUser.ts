import { tool } from "ai";
import { z } from "zod";

export type AskUserOption = { id: string; label: string };

export type AskUserQuestion = {
  id: string;
  prompt: string;
  options: AskUserOption[];
  allow_multiple?: boolean;
  allow_custom?: boolean;
};

export type AskUserInput = {
  title?: string;
  questions: AskUserQuestion[];
};

export type AskUserAnswerItem = {
  questionId: string;
  selectedOptionIds: string[];
  customText?: string;
};

export type AskUserAnswer = {
  answers: AskUserAnswerItem[];
};

type Pending = {
  resolve: (value: AskUserAnswer) => void;
  reject: (error: Error) => void;
};

const pending = new Map<string, Pending>();

function abortError(message = "Ask cancelled"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

/** Wait until the UI resolves this tool call (or abort). */
export function waitForAskUserAnswer(
  toolCallId: string,
  signal?: AbortSignal,
): Promise<AskUserAnswer> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise<AskUserAnswer>((resolve, reject) => {
    const cleanup = () => {
      pending.delete(toolCallId);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    pending.set(toolCallId, {
      resolve: (value) => {
        cleanup();
        resolve(value);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    });

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Resolve a pending ask_user from the chat UI. */
export function resolveAskUserAnswer(
  toolCallId: string,
  answer: AskUserAnswer,
): boolean {
  const entry = pending.get(toolCallId);
  if (!entry) return false;
  entry.resolve(answer);
  return true;
}

export function cancelAskUser(toolCallId: string, reason?: string): boolean {
  const entry = pending.get(toolCallId);
  if (!entry) return false;
  entry.reject(abortError(reason ?? "Ask cancelled"));
  return true;
}

export function cancelAllPendingAskUser(reason?: string): void {
  const ids = [...pending.keys()];
  for (const id of ids) cancelAskUser(id, reason);
}

export function hasPendingAskUser(toolCallId?: string): boolean {
  if (toolCallId) return pending.has(toolCallId);
  return pending.size > 0;
}

const optionSchema = z.object({
  id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional stable option id (derived from the label when omitted)"),
  label: z.string().min(1).describe("Option label shown to the user"),
});

const questionSchema = z.object({
  id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional stable question id (auto-generated when omitted)"),
  prompt: z.string().min(1).describe("Question text"),
  options: z
    .array(optionSchema)
    .min(2)
    .max(8)
    .describe("Answer choices (at least 2)"),
  allow_multiple: z
    .boolean()
    .optional()
    .describe("If true, user may select several options"),
  allow_custom: z
    .boolean()
    .optional()
    .describe(
      "If true (default), user may type a free-text answer instead of/alongside options",
    ),
});

export const askUserInputSchema = z.object({
  title: z
    .string()
    .optional()
    .describe("Optional short title for this question round"),
  questions: z
    .array(questionSchema)
    .min(1)
    .max(5)
    .describe("One or more clarifying questions"),
});

export type AskUserInputRaw = z.infer<typeof askUserInputSchema>;

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function uniqueId(candidate: string, fallback: string, used: Set<string>): string {
  const base = candidate.trim() || fallback;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

/**
 * Models routinely omit the `id` fields, so derive stable ones from position
 * and labels instead of failing the whole tool call.
 */
export function normalizeAskUserInput(raw: AskUserInputRaw): AskUserInput {
  const usedQuestions = new Set<string>();
  return {
    title: raw.title,
    questions: raw.questions.map((q, qi) => {
      const usedOptions = new Set<string>();
      return {
        ...q,
        id: uniqueId(q.id ?? "", `q${qi + 1}`, usedQuestions),
        options: q.options.map((o, oi) => ({
          ...o,
          id: uniqueId(o.id ?? slugify(o.label), `o${oi + 1}`, usedOptions),
        })),
      };
    }),
  };
}

export function buildAskUserTool() {
  return tool({
    description:
      "Ask the user a clarifying multiple-choice question (with optional free-text). Prefer this over listing choices in plain chat text when a decision is needed. Also use this to confirm a plan before heavy or dangerous terminal work or custom scripts. Blocks until the user answers.",
    inputSchema: askUserInputSchema,
    execute: async (input, { toolCallId, abortSignal }) => {
      const { questions } = normalizeAskUserInput(input);
      const answer = await waitForAskUserAnswer(toolCallId, abortSignal);
      return {
        title: input.title ?? null,
        answers: answer.answers.map((item) => {
          const question = questions.find((q) => q.id === item.questionId);
          if (!question) return item;
          return {
            ...item,
            prompt: question.prompt,
            selectedLabels: item.selectedOptionIds.map(
              (id) => question.options.find((o) => o.id === id)?.label ?? id,
            ),
          };
        }),
      };
    },
  });
}

/** Parse tool part input safely (may be partial while streaming). */
export function parseAskUserInput(input: unknown): AskUserInput | null {
  const parsed = askUserInputSchema.safeParse(input);
  if (!parsed.success) return null;
  return normalizeAskUserInput(parsed.data);
}

export function parseAskUserOutput(output: unknown): AskUserAnswer | null {
  if (!output || typeof output !== "object") return null;
  const answers = (output as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return null;
  const items: AskUserAnswerItem[] = [];
  for (const raw of answers) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;
    if (typeof q.questionId !== "string") continue;
    const ids = Array.isArray(q.selectedOptionIds)
      ? q.selectedOptionIds.filter((id): id is string => typeof id === "string")
      : [];
    const custom =
      typeof q.customText === "string" && q.customText.trim()
        ? q.customText.trim()
        : undefined;
    items.push({
      questionId: q.questionId,
      selectedOptionIds: ids,
      customText: custom,
    });
  }
  return items.length ? { answers: items } : null;
}
