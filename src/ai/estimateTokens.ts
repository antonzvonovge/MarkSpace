import { asSchema, isToolUIPart, type ModelMessage, type UIMessage } from "ai";
import {
  estimateAttachmentTokens,
  IMAGE_TOKEN_ESTIMATE,
  isFilePart,
  type ChatAttachment,
} from "./chatAttachments";
import { buildVaultTools } from "./vaultTools";
import type { ChatMode } from "./types";

export type ContextAnchor = {
  /** Tokens for the next prompt with an empty draft (system + tools + history). */
  tokens: number;
  /** `messages.length` when the anchor was recorded. */
  messageCount: number;
};

const toolSchemaTokenCache = new Map<ChatMode, number>();

/** Rough token estimate; non-ASCII (e.g. Cyrillic) counted more conservatively. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4) + other;
}

function partText(part: UIMessage["parts"][number]): string {
  if (part.type === "text") return part.text;
  if (part.type === "reasoning") return part.text ?? "";
  if (isFilePart(part)) return "";
  if (typeof part === "object" && part !== null && "type" in part) {
    const p = part as Record<string, unknown>;
    if (typeof p.input === "object" || typeof p.output === "object") {
      try {
        return JSON.stringify({ input: p.input, output: p.output });
      } catch {
        return "";
      }
    }
    if (typeof p.text === "string") return p.text;
  }
  return "";
}

export function estimateMessagesTokens(messages: UIMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // role overhead
    for (const part of msg.parts ?? []) {
      if (isFilePart(part)) {
        total += IMAGE_TOKEN_ESTIMATE;
        continue;
      }
      total += estimateTokensFromText(partText(part));
    }
  }
  return total;
}

/** Serialize tool names/descriptions/JSON schemas into a token estimate (cached per mode). */
export function estimateToolSchemaTokens(mode: ChatMode): number {
  const cached = toolSchemaTokenCache.get(mode);
  if (cached != null) return cached;

  const tools = buildVaultTools(mode);
  let chars = 0;
  let count = 0;
  for (const [name, t] of Object.entries(tools)) {
    count += 1;
    chars += name.length + 24;
    if (typeof t.description === "string") chars += t.description.length;
    try {
      const json = asSchema(t.inputSchema as Parameters<typeof asSchema>[0])
        .jsonSchema;
      if (json && typeof (json as PromiseLike<unknown>).then !== "function") {
        chars += JSON.stringify(json).length;
      } else {
        chars += 400;
      }
    } catch {
      chars += 400;
    }
  }
  // Extra framing per tool (OpenAI/Anthropic tool-call envelopes).
  const tokens = Math.ceil(chars / 4) + count * 24;
  toolSchemaTokenCache.set(mode, tokens);
  return tokens;
}

/** Text/reasoning after the last tool part — not in final-step inputTokens. */
export function estimateTrailingAssistantOutput(message: UIMessage): number {
  if (message.role !== "assistant") return 0;
  const parts = message.parts ?? [];
  let lastToolIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (isToolUIPart(part) || String(part.type).startsWith("tool-")) {
      lastToolIdx = i;
    }
  }
  let text = "";
  for (let i = lastToolIdx + 1; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.type === "text") text += part.text;
    else if (part.type === "reasoning") text += part.text ?? "";
  }
  if (!text) return 0;
  return estimateTokensFromText(text) + 4;
}

export function estimateModelMessagesTokens(messages: ModelMessage[]): number {
  try {
    return estimateTokensFromText(JSON.stringify(messages));
  } catch {
    return 0;
  }
}

export function estimateContextTokens(opts: {
  system: string;
  messages: UIMessage[];
  draft: string;
  draftAttachments?: ChatAttachment[];
  mode?: ChatMode;
  /** @deprecated Prefer `mode` — fixed overhead undercounts real tool schemas. */
  toolOverhead?: number;
}): number {
  const toolOverhead =
    opts.toolOverhead ??
    (opts.mode ? estimateToolSchemaTokens(opts.mode) : 900);
  return (
    estimateTokensFromText(opts.system) +
    estimateMessagesTokens(opts.messages) +
    estimateTokensFromText(opts.draft) +
    estimateAttachmentTokens(opts.draftAttachments ?? []) +
    toolOverhead
  );
}

/**
 * Prefer a measured anchor from the last API call when history is unchanged;
 * otherwise fall back to (or extend) the heuristic.
 */
export function estimateUsedContext(opts: {
  system: string;
  messages: UIMessage[];
  draft: string;
  draftAttachments?: ChatAttachment[];
  mode: ChatMode;
  anchor: ContextAnchor | null;
}): number {
  const draftTokens =
    estimateTokensFromText(opts.draft) +
    estimateAttachmentTokens(opts.draftAttachments ?? []);
  const toolOverhead = estimateToolSchemaTokens(opts.mode);
  const anchor = opts.anchor;

  if (anchor && anchor.tokens > 0) {
    if (anchor.messageCount === opts.messages.length) {
      return anchor.tokens + draftTokens;
    }
    if (anchor.messageCount < opts.messages.length) {
      const added = opts.messages.slice(anchor.messageCount);
      return (
        anchor.tokens + estimateMessagesTokens(added) + draftTokens
      );
    }
  }

  return (
    estimateTokensFromText(opts.system) +
    estimateMessagesTokens(opts.messages) +
    draftTokens +
    toolOverhead
  );
}

/** Headroom reserved so Send / mid-loop steps fail before the provider does. */
export function contextSafetyMargin(limit: number): number {
  const safe = Math.max(1, limit);
  return Math.max(8_000, Math.round(safe * 0.05));
}

export function wouldExceedContext(used: number, limit: number): boolean {
  return used + contextSafetyMargin(limit) >= Math.max(1, limit);
}

export function buildContextAnchor(opts: {
  lastStepInputTokens: number | null | undefined;
  messages: UIMessage[];
  system: string;
  mode: ChatMode;
}): ContextAnchor {
  const last = opts.messages[opts.messages.length - 1];
  const trailing =
    last?.role === "assistant" ? estimateTrailingAssistantOutput(last) : 0;
  const measured = opts.lastStepInputTokens;
  const tokens =
    measured != null && measured > 0
      ? measured + trailing
      : estimateUsedContext({
          system: opts.system,
          messages: opts.messages,
          draft: "",
          mode: opts.mode,
          anchor: null,
        });
  return { tokens, messageCount: opts.messages.length };
}

export function formatTokenCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}
