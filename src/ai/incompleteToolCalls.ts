import {
  isToolUIPart,
  type ToolSet,
  type UIMessage,
} from "ai";

const INCOMPLETE_TOOL_STATES = new Set([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

const SETTLED_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

export const INCOMPLETE_TOOL_REASON_ABORTED = "Cancelled.";
export const INCOMPLETE_TOOL_REASON_DROPPED = "Tool did not finish.";

function toolState(part: UIMessage["parts"][number]): string {
  return "state" in part ? String(part.state) : "";
}

export function isIncompleteToolPart(
  part: UIMessage["parts"][number],
): boolean {
  if (!isToolUIPart(part)) return false;
  const state = toolState(part);
  if (SETTLED_TOOL_STATES.has(state)) return false;
  if (INCOMPLETE_TOOL_STATES.has(state)) return true;
  return !("output" in part && (part as { output?: unknown }).output != null);
}

export function settleIncompleteToolPart(
  part: UIMessage["parts"][number],
  reason: string,
): UIMessage["parts"][number] {
  if (!isToolUIPart(part)) return part;
  return {
    ...part,
    state: "output-error",
    errorText: reason,
  } as UIMessage["parts"][number];
}

export function settleIncompleteParts(
  parts: UIMessage["parts"],
  reason: string,
): UIMessage["parts"] {
  let changed = false;
  const next = parts.map((part) => {
    if (!isIncompleteToolPart(part)) return part;
    changed = true;
    return settleIncompleteToolPart(part, reason);
  });
  return changed ? next : parts;
}

export function settleIncompleteToolCalls(
  messages: UIMessage[],
  reason = INCOMPLETE_TOOL_REASON_DROPPED,
): UIMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "assistant") return message;
    const parts = settleIncompleteParts(message.parts ?? [], reason);
    if (parts === (message.parts ?? [])) return message;
    changed = true;
    return { ...message, parts };
  });
  return changed ? next : messages;
}

export function hasIncompleteToolCalls(messages: UIMessage[]): boolean {
  return messages.some((message) =>
    (message.parts ?? []).some(isIncompleteToolPart),
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return INCOMPLETE_TOOL_REASON_DROPPED;
}

type ExecutableTool = {
  execute?: (
    input: unknown,
    options: {
      toolCallId: string;
      messages: [];
      abortSignal?: AbortSignal;
      context?: unknown;
    },
  ) => Promise<unknown> | AsyncIterable<unknown>;
};

async function readExecuteResult(
  result: Promise<unknown> | AsyncIterable<unknown>,
): Promise<unknown> {
  if (
    result &&
    typeof result === "object" &&
    Symbol.asyncIterator in result
  ) {
    let output: unknown;
    for await (const part of result as AsyncIterable<unknown>) {
      if (part && typeof part === "object" && "type" in part) {
        const chunk = part as { type?: string; output?: unknown };
        if (chunk.type !== "preliminary") output = chunk.output ?? part;
      } else {
        output = part;
      }
    }
    return output;
  }
  return await result;
}

/**
 * Run tools the model requested but the SDK stream dropped (no tool-result).
 * Used when Gemini/OpenRouter ends a step after emitting a tool-call.
 */
export async function executeIncompleteParts(params: {
  parts: UIMessage["parts"];
  tools: ToolSet;
  abortSignal?: AbortSignal;
}): Promise<{ parts: UIMessage["parts"]; executed: number }> {
  const next = [...params.parts];
  let executed = 0;

  for (let i = 0; i < next.length; i++) {
    const part = next[i];
    if (!part || !isIncompleteToolPart(part)) continue;

    if (params.abortSignal?.aborted) {
      next[i] = settleIncompleteToolPart(part, INCOMPLETE_TOOL_REASON_ABORTED);
      continue;
    }

    const toolName =
      "toolName" in part && typeof part.toolName === "string"
        ? part.toolName
        : String(part.type).replace(/^tool-/, "");
    const toolCallId =
      "toolCallId" in part && typeof part.toolCallId === "string"
        ? part.toolCallId
        : "";
    const input = "input" in part ? part.input : undefined;
    const tool = params.tools[toolName] as ExecutableTool | undefined;

    if (typeof tool?.execute !== "function" || !toolCallId) {
      next[i] = settleIncompleteToolPart(part, INCOMPLETE_TOOL_REASON_DROPPED);
      continue;
    }

    try {
      const output = await readExecuteResult(
        tool.execute(input, {
          toolCallId,
          messages: [],
          abortSignal: params.abortSignal,
          context: undefined,
        }),
      );
      next[i] = {
        ...part,
        state: "output-available",
        input,
        output,
      } as UIMessage["parts"][number];
      executed += 1;
    } catch (error) {
      next[i] = settleIncompleteToolPart(part, errorText(error));
      executed += 1;
    }
  }

  return { parts: next, executed };
}
