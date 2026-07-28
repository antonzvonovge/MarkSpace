import type { AiModelOption } from "./types";

/** Curated OpenRouter catalog: OpenAI, Anthropic, Google. */
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
    id: "openai/gpt-5.3-chat",
    label: "GPT-5.3 Chat",
    vendor: "openai",
    kind: "chat",
    contextWindow: 128_000,
  },
  // OpenAI — reasoning
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    vendor: "openai",
    kind: "reasoning",
    contextWindow: 1_050_000,
  },
  {
    id: "openai/gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    vendor: "openai",
    kind: "reasoning",
    contextWindow: 400_000,
  },
  {
    id: "openai/o3",
    label: "o3",
    vendor: "openai",
    kind: "reasoning",
    contextWindow: 200_000,
  },
  {
    id: "openai/o4-mini",
    label: "o4 Mini",
    vendor: "openai",
    kind: "reasoning",
    contextWindow: 200_000,
  },
  // Anthropic
  {
    id: "anthropic/claude-opus-4.8",
    label: "Claude Opus 4.8",
    vendor: "anthropic",
    kind: "reasoning",
    contextWindow: 1_000_000,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
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
    id: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    vendor: "google",
    kind: "reasoning",
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

export function formatModelOptionLabel(m: AiModelOption): string {
  return `${m.label} · ${KIND_LABEL[m.kind]}`;
}

export function findModel(
  models: AiModelOption[],
  modelId: string,
): AiModelOption | undefined {
  return models.find((m) => m.id === modelId);
}

/** Whether this OpenRouter model should request / display thinking tokens. */
export function modelSupportsReasoning(
  modelId: string,
  models: AiModelOption[] = OPENROUTER_MODELS,
): boolean {
  const found = findModel(models, modelId);
  if (found) return found.kind === "reasoning";
  // Fallback heuristics for custom / legacy ids
  if (/gpt-4\.1|gpt-4o|gpt-5(\.\d+)?-chat/i.test(modelId)) return false;
  return (
    /\/(o[0-9]|gpt-5)/i.test(modelId) ||
    modelId.startsWith("anthropic/") ||
    modelId.startsWith("google/")
  );
}
