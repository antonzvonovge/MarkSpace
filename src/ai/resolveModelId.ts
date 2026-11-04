import { formatModelRef, parseModelRef } from "./modelRef";
import { OPENROUTER_MODELS } from "./models";

/**
 * Normalize a catalog/thread model ref (`vendor/model` or `vendor/model@prv_…`).
 * Bare OpenAI ids get an `openai/` prefix; unknown bare ids pass through.
 * Provider binding suffix is preserved when present.
 */
export function resolveModelId(_baseUrl: string, modelId: string): string {
  const parsed = parseModelRef(modelId || "");
  let id = parsed.modelId;
  if (!id) return OPENROUTER_MODELS[0]?.id ?? "openai/gpt-5.6-sol";

  // Legacy openai.com bare ids
  if (!id.includes("/")) {
    if (/^(gpt-|o[0-9]|chatgpt-)/i.test(id)) {
      id = `openai/${id}`;
    }
  }

  return formatModelRef(id, parsed.providerId);
}
