import { generateText, isToolUIPart, type UIMessage } from "ai";
import { unwrapComposerMarkers } from "../lib/chatComposerDom";
import {
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";

/** Keep the newest N UI messages verbatim — new user turns usually depend on them. */
export const KEEP_RECENT_MESSAGES = 2;

/** Prefer a cheap model for the compaction call; fall back to the chat model. */
const COMPACT_SYSTEM = `You compact chat history for MarkSpace, a local Markdown vault assistant.
Write a dense continuity brief that a future assistant turn will read instead of the older messages.

Preserve:
- User goals, constraints, and preferences
- Decisions and their rationale
- Vault-relative file/folder paths that matter
- Edits or creations already done (what changed where)
- Open questions and unfinished work
- Important facts, names, and numbers

Omit:
- Chit-chat and acknowledgements
- Raw tool dumps, full file contents, and repetitive search hits
- Reasoning traces

Write in the same language as the conversation.
Do not address the user. No preamble like "Here is a summary".
Use short paragraphs or bullet lists.`;

const MAX_TRANSCRIPT_CHARS = 100_000;
const TOOL_SNIPPET_CHARS = 600;

export function splitForCompaction(messages: UIMessage[]): {
  older: UIMessage[];
  recent: UIMessage[];
} {
  if (messages.length <= KEEP_RECENT_MESSAGES) {
    return { older: [], recent: [...messages] };
  }
  return {
    older: messages.slice(0, -KEEP_RECENT_MESSAGES),
    recent: messages.slice(-KEEP_RECENT_MESSAGES),
  };
}

function toolSnippet(value: unknown): string {
  try {
    const raw =
      typeof value === "string" ? value : JSON.stringify(value ?? null);
    if (!raw) return "";
    if (raw.length <= TOOL_SNIPPET_CHARS) return raw;
    return `${raw.slice(0, TOOL_SNIPPET_CHARS)}…`;
  } catch {
    return "";
  }
}

/** Flatten a message for the compaction prompt (tools truncated). */
export function messageToTranscriptLine(message: UIMessage): string {
  const chunks: string[] = [];
  for (const part of message.parts ?? []) {
    if (part.type === "text") {
      const text = unwrapComposerMarkers(part.text).trim();
      if (text) chunks.push(text);
      continue;
    }
    if (part.type === "reasoning") continue;
    if (isToolUIPart(part)) {
      const name =
        "toolName" in part && typeof part.toolName === "string"
          ? part.toolName
          : String(part.type).replace(/^tool-/, "");
      const input =
        "input" in part ? toolSnippet((part as { input?: unknown }).input) : "";
      const output =
        "output" in part
          ? toolSnippet((part as { output?: unknown }).output)
          : "";
      const err =
        "errorText" in part &&
        typeof (part as { errorText?: unknown }).errorText === "string"
          ? (part as { errorText: string }).errorText.slice(0, 200)
          : "";
      const bits = [`tool ${name}`];
      if (input) bits.push(`in=${input}`);
      if (output) bits.push(`out=${output}`);
      if (err) bits.push(`error=${err}`);
      chunks.push(`[${bits.join(" ")}]`);
    }
  }
  if (chunks.length === 0) return "";
  const label = message.role === "user" ? "User" : "Assistant";
  return `${label}:\n${chunks.join("\n")}`;
}

export function buildCompactionTranscript(older: UIMessage[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const message of older) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const line = messageToTranscriptLine(message);
    if (!line) continue;
    if (used + line.length + 1 > MAX_TRANSCRIPT_CHARS) {
      const room = Math.max(0, MAX_TRANSCRIPT_CHARS - used - 1);
      if (room > 80) lines.push(`${line.slice(0, room)}…`);
      lines.push("…[earlier transcript truncated]");
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n\n");
}

function sanitizeSummary(raw: string): string {
  let t = raw.replace(/^\s*```(?:\w+)?\s*/u, "").replace(/\s*```\s*$/u, "");
  t = t.trim();
  if (!t) return "";
  // Soft cap so the summary itself cannot refill the window.
  if (t.length > 12_000) t = `${t.slice(0, 12_000).trim()}…`;
  return t;
}

export function formatCompactionMessage(summary: string): UIMessage {
  const body = [
    "Context compacted to free space for new messages.",
    "Earlier turns were summarized; the messages after this one are the most recent and were kept in full.",
    "",
    "### Earlier conversation",
    "",
    summary,
  ].join("\n");
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [{ type: "text", text: body }],
  };
}

export type CompactChatHistoryParams = {
  messages: UIMessage[];
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
};

export type CompactChatHistoryResult = {
  messages: UIMessage[];
  /** False when there was nothing older to compact. */
  compacted: boolean;
};

export async function compactChatHistory(
  params: CompactChatHistoryParams,
): Promise<CompactChatHistoryResult> {
  const { older, recent } = splitForCompaction(params.messages);
  if (older.length === 0) {
    return { messages: [...params.messages], compacted: false };
  }

  const transcript = buildCompactionTranscript(older);
  if (!transcript.trim()) {
    return {
      messages: [formatCompactionMessage("(no textual content)"), ...recent],
      compacted: true,
    };
  }

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: COMPACT_SYSTEM,
      prompt: `Compact this older conversation into a continuity brief:\n\n${transcript}`,
      maxOutputTokens: 4_096,
      abortSignal: params.abortSignal,
      temperature: 0.2,
    });
    return sanitizeSummary(text);
  };

  const summary = await runWithModelFallback({
    keys: params.keys,
    modelId: params.modelId,
    fallbackModelId: params.fallbackModelId,
    isEmpty: (text) => !text,
    run: tryModel,
  });

  if (!summary) {
    throw new Error("Could not compact conversation history");
  }

  return {
    messages: [formatCompactionMessage(summary), ...recent],
    compacted: true,
  };
}
