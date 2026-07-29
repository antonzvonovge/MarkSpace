import type { UIMessage } from "ai";
import {
  estimateAttachmentTokens,
  IMAGE_TOKEN_ESTIMATE,
  isFilePart,
  type ChatAttachment,
} from "./chatAttachments";

/** Rough token estimate: ~4 chars per token + fixed tool schema overhead. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
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

export function estimateContextTokens(opts: {
  system: string;
  messages: UIMessage[];
  draft: string;
  draftAttachments?: ChatAttachment[];
  toolOverhead?: number;
}): number {
  const toolOverhead = opts.toolOverhead ?? 900;
  return (
    estimateTokensFromText(opts.system) +
    estimateMessagesTokens(opts.messages) +
    estimateTokensFromText(opts.draft) +
    estimateAttachmentTokens(opts.draftAttachments ?? []) +
    toolOverhead
  );
}

export function formatTokenCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}
