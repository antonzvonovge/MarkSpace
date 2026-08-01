import { generateText, type UIMessage } from "ai";
import {
  hasCredentialsForModel,
  resolveLanguageModel,
  type AiProviderCredentials,
} from "./languageModel";

/** Cheap, fast model for naming — falls back to chat model if needed. */
const TITLE_MODEL = "openai/gpt-4.1-mini";

const TITLE_SYSTEM = `You name chat threads for a notes app.
Reply with ONLY a short title (3–7 words). Same language as the conversation.
No quotes, no trailing punctuation, no emoji, no "Chat about".`;

function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function sanitizeTitle(raw: string): string | null {
  let t = raw
    .replace(/^["'«»„“”]|["'«»„“”]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/[.!?…]+$/u, "").trim();
  if (!t || /^new chat$/i.test(t)) return null;
  if (t.length > 60) t = `${t.slice(0, 60).trim()}…`;
  return t;
}

function conversationSnippet(messages: UIMessage[], maxChars = 1200): string {
  const lines: string[] = [];
  let used = 0;
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = messageText(m);
    if (!text) continue;
    const label = m.role === "user" ? "User" : "Assistant";
    const line = `${label}: ${text}`;
    if (used + line.length > maxChars) {
      lines.push(`${line.slice(0, Math.max(0, maxChars - used))}…`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export type GenerateChatTitleParams = {
  messages: UIMessage[];
  keys: AiProviderCredentials;
  /** Prefer chat model if title model is unavailable. */
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
};

export async function generateChatTitle(
  params: GenerateChatTitleParams,
): Promise<string | null> {
  const snippet = conversationSnippet(params.messages);
  if (!snippet.trim()) return null;

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: TITLE_SYSTEM,
      prompt: `Name this chat:\n\n${snippet}`,
      maxOutputTokens: 40,
      abortSignal: params.abortSignal,
      temperature: 0.4,
    });
    return sanitizeTitle(text);
  };

  if (hasCredentialsForModel(TITLE_MODEL, params.keys)) {
    try {
      const titled = await tryModel(TITLE_MODEL);
      if (titled) return titled;
    } catch {
      /* try fallback */
    }
  }

  const fallback = params.fallbackModelId?.trim();
  if (fallback && fallback !== TITLE_MODEL) {
    try {
      return await tryModel(fallback);
    } catch {
      return null;
    }
  }
  return null;
}
