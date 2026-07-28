import { OPENROUTER_BASE_URL, OPENROUTER_MODELS } from "./models";

export type ChatMode = "ask" | "agent";

export type AiModelVendor = "openai" | "anthropic" | "google";

/** How the model is meant to be used — shown in the chat model picker. */
export type AiModelKind = "chat" | "reasoning";

export type AiModelOption = {
  id: string;
  label: string;
  vendor: AiModelVendor;
  kind: AiModelKind;
  contextWindow?: number;
};

export type AiSettings = {
  /** Always OpenRouter; kept for persistence / SDK baseURL. */
  baseUrl: string;
  apiKey: string;
  /**
   * Optional Tavily API key. When set, web_search + fetch_url use Tavily;
   * otherwise free DuckDuckGo search + Jina Reader fetch.
   */
  tavilyApiKey: string;
  modelId: string;
  defaultMode: ChatMode;
  /** Default context window when model does not override */
  contextWindow: number;
  models: AiModelOption[];
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: OPENROUTER_BASE_URL,
  apiKey: "",
  tavilyApiKey: "",
  modelId: "anthropic/claude-sonnet-4.6",
  defaultMode: "ask",
  contextWindow: 200_000,
  models: [...OPENROUTER_MODELS],
};

export function contextWindowForModel(
  settings: AiSettings,
  modelId: string,
): number {
  const found = settings.models.find((m) => m.id === modelId);
  if (found?.contextWindow && found.contextWindow > 0) {
    return found.contextWindow;
  }
  return settings.contextWindow > 0 ? settings.contextWindow : 128_000;
}
