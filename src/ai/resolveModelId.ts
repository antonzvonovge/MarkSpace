import { OPENROUTER_MODELS } from "./models";

/**
 * Normalize model id for OpenRouter (`vendor/model`).
 * Bare OpenAI ids get an `openai/` prefix; unknown bare ids pass through.
 */
export function resolveModelId(_baseUrl: string, modelId: string): string {
  let id = (modelId || "").trim();
  if (!id) return OPENROUTER_MODELS[0]?.id ?? "openai/gpt-5.6-sol";

  // Legacy openai.com bare ids
  if (!id.includes("/")) {
    if (/^(gpt-|o[0-9]|chatgpt-)/i.test(id)) {
      return `openai/${id}`;
    }
  }

  return id;
}
