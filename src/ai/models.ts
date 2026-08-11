import type { AiModelOption } from "./types";

/**
 * Curated model catalog (`vendor/model` ids).
 * Routed via direct provider BYOK when that key is set, otherwise OpenRouter.
 */
export const OPENROUTER_MODELS: AiModelOption[] = [
  // OpenAI — chat
  {
    id: "openai/gpt-4.1",
    label: "GPT-4.1",
    vendor: "openai",
    kind: "chat",
    contextWindow: 1_047_576,
  },
  {
    id: "openai/gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    vendor: "openai",
    kind: "chat",
    contextWindow: 1_047_576,
  },
  {
    id: "openai/gpt-5.2-chat",
    label: "GPT-5.2 Chat",
    vendor: "openai",
    kind: "chat",
    contextWindow: 128_000,
  },
  // OpenAI — reasoning
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    vendor: "openai",
    kind: "reasoning",
    contextWindow: 1_050_000,
  },
  {
    id: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    vendor: "openai",
    kind: "reasoning",
    contextWindow: 1_050_000,
  },
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    vendor: "openai",
    kind: "reasoning",
    contextWindow: 1_050_000,
  },
  // Anthropic
  {
    id: "anthropic/claude-opus-5",
    label: "Claude Opus 5",
    vendor: "anthropic",
    kind: "reasoning",
    contextWindow: 1_000_000,
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    vendor: "anthropic",
    kind: "reasoning",
    contextWindow: 1_000_000,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    vendor: "anthropic",
    kind: "reasoning",
    contextWindow: 200_000,
  },
  // Google
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    vendor: "google",
    kind: "reasoning",
    contextWindow: 1_048_576,
  },
  {
    id: "google/gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    vendor: "google",
    kind: "reasoning",
    contextWindow: 1_048_576,
  },
  {
    id: "google/gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    vendor: "google",
    kind: "chat",
    contextWindow: 1_048_576,
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    vendor: "google",
    kind: "reasoning",
    contextWindow: 1_048_576,
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    vendor: "google",
    kind: "reasoning",
    contextWindow: 1_048_576,
  },
];

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const VENDOR_LABEL: Record<AiModelOption["vendor"], string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

export const KIND_LABEL: Record<AiModelOption["kind"], string> = {
  chat: "Chat",
  reasoning: "Reasoning",
};

export function findModel(
  models: AiModelOption[],
  modelId: string,
): AiModelOption | undefined {
  return models.find((m) => m.id === modelId);
}

/** Whether this model should request / display thinking tokens. */
export function modelSupportsReasoning(
  modelId: string,
  models: AiModelOption[] = OPENROUTER_MODELS,
): boolean {
  const found = findModel(models, modelId);
  if (found) return found.kind === "reasoning";
  // Fallback heuristics for custom / legacy ids
  if (
    /gpt-4\.1|gpt-4o|gpt-5(\.\d+)?-chat|gpt-chat-latest|flash-lite/i.test(
      modelId,
    )
  ) {
    return false;
  }
  return (
    /\/(o[0-9]|gpt-5)/i.test(modelId) ||
    modelId.startsWith("anthropic/") ||
    modelId.startsWith("google/")
  );
}
