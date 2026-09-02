import type { AiModelOption } from "./types";
import { DEFAULT_WORKER_MODEL_ID } from "../lib/vaultAiSettings";

/**
 * Curated model catalog (`vendor/model` ids).
 * Routed via direct provider BYOK when that key is set, otherwise the OpenAI-compatible gateway.
 */
export const OPENROUTER_MODELS: AiModelOption[] = [
  // OpenAI — flagship
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    vendor: "openai",
    kind: "reasoning",
    tier: "flagship",
    contextWindow: 1_050_000,
  },
  {
    id: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    vendor: "openai",
    kind: "reasoning",
    tier: "flagship",
    contextWindow: 1_050_000,
  },
  // OpenAI — worker
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    vendor: "openai",
    kind: "reasoning",
    tier: "worker",
    contextWindow: 1_050_000,
  },
  {
    id: DEFAULT_WORKER_MODEL_ID,
    label: "GPT-4.1 Mini",
    vendor: "openai",
    kind: "chat",
    tier: "worker",
    contextWindow: 1_047_576,
  },
  // Google — flagship
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    vendor: "google",
    kind: "reasoning",
    tier: "flagship",
    contextWindow: 1_048_576,
  },
  {
    id: "google/gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    vendor: "google",
    kind: "reasoning",
    tier: "flagship",
    contextWindow: 1_048_576,
  },
  // Google — worker
  {
    id: "google/gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    vendor: "google",
    kind: "chat",
    tier: "worker",
    contextWindow: 1_048_576,
  },
];

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
/** Legacy OpenRouter endpoint — used when migrating an old OpenRouter-only key. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const VENDOR_LABEL: Record<AiModelOption["vendor"], string> = {
  openai: "OpenAI",
  google: "Google",
};

export const KIND_LABEL: Record<AiModelOption["kind"], string> = {
  chat: "Chat",
  reasoning: "Reasoning",
};

export const TIER_LABEL: Record<AiModelOption["tier"], string> = {
  flagship: "Flagship",
  worker: "Worker",
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
  return /\/(o[0-9]|gpt-5)/i.test(modelId) || modelId.startsWith("google/");
}
