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
  /** OpenRouter API key (fallback when no direct provider key). */
  apiKey: string;
  /** Direct OpenAI API key — bypasses OpenRouter when set. */
  openaiApiKey: string;
  /** Direct Anthropic API key — bypasses OpenRouter when set. */
  anthropicApiKey: string;
  /** Direct Google AI API key — bypasses OpenRouter when set. */
  googleApiKey: string;
  /**
   * Optional Tavily API key. When set, web_search / fetch_url / clip_article prefer Tavily;
   * otherwise free DuckDuckGo + Jina. Tools may override via provider.
   */
  tavilyApiKey: string;
  /**
   * Optional Firecrawl API key for scrape_url and for clip_article when
   * provider=firecrawl is requested. Not used by fetch_url or default clip auto-pick.
   */
  firecrawlApiKey: string;
  modelId: string;
  defaultMode: ChatMode;
  /** Default context window when model does not override */
  contextWindow: number;
  models: AiModelOption[];
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: OPENROUTER_BASE_URL,
  apiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  googleApiKey: "",
  tavilyApiKey: "",
  firecrawlApiKey: "",
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
