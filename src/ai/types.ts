import { OPENROUTER_BASE_URL, OPENROUTER_MODELS } from "./models";

export type ChatMode = "ask" | "agent";

export type AiModelVendor = "openai" | "anthropic" | "google";

/** How the model is meant to be used — thinking tokens in the chat picker. */
export type AiModelKind = "chat" | "reasoning";

/** Cost / role class — Flagship for chats, Worker for specialists and helpers. */
export type AiModelTier = "flagship" | "worker";

export type AiModelOption = {
  id: string;
  label: string;
  vendor: AiModelVendor;
  kind: AiModelKind;
  tier: AiModelTier;
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
  /**
   * Max model↔tool rounds per user send (`stopWhen`). Resets every time you
   * send a message; not a session-wide budget.
   */
  agentMaxSteps: number;
  /**
   * When true, Agent mode may call `run_terminal`. Off by default — each
   * command still needs Allow / Deny unless the chat has auto-allow.
   */
  agentTerminalEnabled: boolean;
  /** Default context window when model does not override */
  contextWindow: number;
  models: AiModelOption[];
};

/** Default / clamp bounds for `AiSettings.agentMaxSteps`. */
export const DEFAULT_AGENT_MAX_STEPS = 12;
export const AGENT_MAX_STEPS_MIN = 1;
export const AGENT_MAX_STEPS_MAX = 64;

export function clampAgentMaxSteps(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AGENT_MAX_STEPS;
  }
  return Math.min(
    AGENT_MAX_STEPS_MAX,
    Math.max(AGENT_MAX_STEPS_MIN, Math.round(value)),
  );
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: OPENROUTER_BASE_URL,
  apiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  googleApiKey: "",
  tavilyApiKey: "",
  firecrawlApiKey: "",
  modelId: "anthropic/claude-sonnet-5",
  defaultMode: "ask",
  agentMaxSteps: DEFAULT_AGENT_MAX_STEPS,
  agentTerminalEnabled: false,
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
