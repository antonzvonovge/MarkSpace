import type { GeminiContent } from "./types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

function parseApiErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string };
    };
    const msg = parsed.error?.message?.trim();
    return msg || null;
  } catch {
    return null;
  }
}

function userFacingError(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "Invalid Google AI API key. Check Settings → ContextGem → Options.";
  }
  if (status === 429) {
    return (
      parseApiErrorMessage(body) ??
      "Rate limit reached. Wait a moment and try again."
    );
  }

  const apiMessage = parseApiErrorMessage(body);
  if (apiMessage) return apiMessage;

  if (status >= 500) {
    return `Google AI service error (${status}). Try again later.`;
  }

  return `Request failed (${status}).`;
}

type StreamPart = {
  text?: string;
  thought?: boolean;
};

type StreamChunk = {
  candidates?: {
    content?: { parts?: StreamPart[] };
  }[];
};

export async function* streamGeminiChat(params: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  contents: GeminiContent[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const url =
    `${GEMINI_BASE}/models/${encodeURIComponent(params.model)}` +
    `:streamGenerateContent?alt=sse&key=${encodeURIComponent(params.apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: params.signal,
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: params.systemInstruction }],
      },
      contents: params.contents,
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.4,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GeminiError(userFacingError(response.status, body), response.status);
  }

  if (!response.body) {
    throw new GeminiError("Empty response from Google AI.", 0);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const jsonText = trimmed.slice(5).trim();
      if (!jsonText || jsonText === "[DONE]") continue;

      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(jsonText) as StreamChunk;
      } catch {
        continue;
      }

      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.thought) continue;
        if (typeof part.text === "string" && part.text.length > 0) {
          yield part.text;
        }
      }
    }
  }
}

export function toGeminiContents(
  messages: { role: "user" | "assistant"; content: string }[],
): GeminiContent[] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}
