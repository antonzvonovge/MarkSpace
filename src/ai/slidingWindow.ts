import type { ModelMessage } from "ai";
import {
  contextSafetyMargin,
  estimateModelMessagesTokens,
  estimateTokensFromText,
  wouldExceedContext,
} from "./estimateTokens";

/** Newest tool-results kept verbatim before older ones are stubbed. */
export const KEEP_RECENT_TOOL_RESULTS = 3;

export const TOOL_RESULT_OMITTED_PREFIX = "[omitted from context";

const COMPACTION_MARKER = "Context compacted to free space for new messages.";

export const CONTEXT_FULL_DURING_TOOLS =
  "Context window is full (during tool use). Start a new chat or shorten the conversation.";

type ToolCallLike = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input?: unknown;
};

type ToolResultLike = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
};

type ResultLoc = {
  messageIndex: number;
  partIndex: number;
  toolName: string;
  hint?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToolCallPart(part: unknown): part is ToolCallLike {
  return (
    isRecord(part) &&
    part.type === "tool-call" &&
    typeof part.toolCallId === "string"
  );
}

function isToolResultPart(part: unknown): part is ToolResultLike {
  return (
    isRecord(part) &&
    part.type === "tool-result" &&
    typeof part.toolCallId === "string"
  );
}

function pathHint(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  if (typeof input.path === "string" && input.path.trim()) return input.path.trim();
  if (typeof input.url === "string" && input.url.trim()) return input.url.trim();
  return undefined;
}

function serializeOutput(output: unknown): string {
  if (isRecord(output) && typeof output.type === "string") {
    if (output.type === "text" || output.type === "error-text") {
      return typeof output.value === "string" ? output.value : "";
    }
    if (output.type === "json" || output.type === "error-json") {
      try {
        return JSON.stringify(output.value ?? null);
      } catch {
        return "";
      }
    }
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function isOmittedOutput(output: unknown): boolean {
  return serializeOutput(output).startsWith(TOOL_RESULT_OMITTED_PREFIX);
}

function formatOmittedStub(
  toolName: string,
  hint: string | undefined,
  originalTokens: number,
): string {
  const where = hint ? ` · ${hint}` : "";
  return `${TOOL_RESULT_OMITTED_PREFIX} · ${toolName}${where} · ~${originalTokens} tokens. Call the tool again if you need the full output.]`;
}

function omittedOutput(
  toolName: string,
  hint: string | undefined,
  original: unknown,
): { type: "text"; value: string } {
  const originalTokens = estimateTokensFromText(serializeOutput(original));
  return {
    type: "text",
    value: formatOmittedStub(toolName, hint, originalTokens),
  };
}

function messageText(message: ModelMessage): string {
  if (message.role !== "user" && message.role !== "assistant") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const chunks: string[] = [];
  for (const part of content) {
    if (part.type === "text") chunks.push(part.text);
  }
  return chunks.join("\n");
}

export function isCompactionModelMessage(message: ModelMessage): boolean {
  return message.role === "assistant" && messageText(message).includes(COMPACTION_MARKER);
}

function cloneMessages(messages: ModelMessage[]): ModelMessage[] {
  try {
    return structuredClone(messages);
  } catch {
    return JSON.parse(JSON.stringify(messages)) as ModelMessage[];
  }
}

function collectResultLocs(messages: ModelMessage[]): ResultLoc[] {
  const inputs = new Map<string, { toolName: string; input: unknown }>();
  const locs: ResultLoc[] = [];
  messages.forEach((message, messageIndex) => {
    const parts = Array.isArray(message.content) ? message.content : [];
    parts.forEach((part, partIndex) => {
      if (isToolCallPart(part)) {
        inputs.set(part.toolCallId, {
          toolName: part.toolName,
          input: part.input,
        });
        return;
      }
      if (!isToolResultPart(part)) return;
      const meta = inputs.get(part.toolCallId);
      locs.push({
        messageIndex,
        partIndex,
        toolName:
          (typeof part.toolName === "string" && part.toolName) ||
          meta?.toolName ||
          "tool",
        hint: pathHint(meta?.input),
      });
    });
  });
  return locs;
}

function stubOlderResults(
  messages: ModelMessage[],
  keepLast: number,
): ModelMessage[] {
  const locs = collectResultLocs(messages);
  const cutoff = Math.max(0, locs.length - Math.max(0, keepLast));
  if (cutoff === 0) return messages;

  const cloned = cloneMessages(messages);
  const clonedLocs = collectResultLocs(cloned);
  for (let i = 0; i < cutoff; i++) {
    const loc = clonedLocs[i];
    if (!loc) continue;
    const message = cloned[loc.messageIndex];
    if (!message || !Array.isArray(message.content)) continue;
    const part = message.content[loc.partIndex];
    if (!isToolResultPart(part) || isOmittedOutput(part.output)) continue;
    part.output = omittedOutput(loc.toolName, loc.hint, part.output);
  }
  return cloned;
}

function groupTurns(messages: ModelMessage[]): ModelMessage[][] {
  const turns: ModelMessage[][] = [];
  let current: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "user" && current.length > 0) {
      turns.push(current);
      current = [message];
    } else {
      current.push(message);
    }
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

function isProtectedTurn(turn: ModelMessage[]): boolean {
  if (turn.some((m) => m.role === "system")) return true;
  if (turn.some(isCompactionModelMessage)) return true;
  return false;
}

function dropOldTurns(
  messages: ModelMessage[],
  budget: number,
): ModelMessage[] {
  const turns = groupTurns(messages);
  let lastUserTurn = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]!.some((m) => m.role === "user")) {
      lastUserTurn = i;
      break;
    }
  }
  if (lastUserTurn <= 0) return messages;

  const kept = turns.slice();
  while (!fitsBudget(kept.flat(), budget)) {
    const dropAt = kept.findIndex(
      (turn, index) => index < lastUserTurn && !isProtectedTurn(turn),
    );
    if (dropAt < 0) break;
    kept.splice(dropAt, 1);
    lastUserTurn -= 1;
  }
  return kept.flat();
}

function fitsBudget(messages: ModelMessage[], budget: number): boolean {
  return estimateModelMessagesTokens(messages) <= budget;
}

/** Max tokens allowed for model messages given the context window and extras. */
export function messageTokenBudget(
  contextWindow: number,
  extraTokens = 0,
): number {
  const limit = Math.max(1, contextWindow);
  return Math.max(1, limit - contextSafetyMargin(limit) - Math.max(0, extraTokens));
}

/**
 * Trim a copy of `messages` to fit `budget` tokens.
 * Does not mutate the input. Tool-call / tool-result pairs stay intact.
 */
export function windowModelMessages(
  messages: ModelMessage[],
  budget: number,
): ModelMessage[] {
  const cap = Math.max(1, budget);
  if (fitsBudget(messages, cap)) return messages;

  let next = stubOlderResults(messages, KEEP_RECENT_TOOL_RESULTS);
  if (fitsBudget(next, cap)) return next;

  next = stubOlderResults(messages, 1);
  if (fitsBudget(next, cap)) return next;

  next = stubOlderResults(messages, 0);
  if (fitsBudget(next, cap)) return next;

  return dropOldTurns(next, cap);
}

/**
 * Window messages for a model call. Throws if even the latest user turn
 * cannot fit after stubbing tool results and dropping older turns.
 */
export function applySlidingWindow(opts: {
  messages: ModelMessage[];
  contextWindow: number;
  extraTokens?: number;
}): ModelMessage[] {
  const extra = opts.extraTokens ?? 0;
  const windowed = windowModelMessages(
    opts.messages,
    messageTokenBudget(opts.contextWindow, extra),
  );
  const used = extra + estimateModelMessagesTokens(windowed);
  if (wouldExceedContext(used, opts.contextWindow)) {
    throw new Error(CONTEXT_FULL_DURING_TOOLS);
  }
  return windowed;
}
