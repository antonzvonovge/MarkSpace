import { OPENAI_BASE_URL, OPENROUTER_MODELS } from "./models";

export type ChatMode = "ask" | "agent";

/** Composer reasoning: forced off, worker decides per turn, or always on. */
export type ReasoningMode = "off" | "auto" | "on";

export function isReasoningMode(value: unknown): value is ReasoningMode {
  return value === "off" || value === "auto" || value === "on";
}

export function cycleReasoningMode(current: ReasoningMode): ReasoningMode {
  if (current === "off") return "auto";
  if (current === "auto") return "on";
  return "off";
}

/** New chats default to Auto. Older threads without `reasoningMode` stay On/Off. */
export function resolveThreadReasoningMode(opts: {
  supports: boolean;
  reasoningMode?: string | null;
  enableReasoning?: boolean | null;
  /** When neither field is stored (brand-new thread). */
  defaultAuto?: boolean;
}): ReasoningMode {
  if (!opts.supports) return "off";
  if (isReasoningMode(opts.reasoningMode)) return opts.reasoningMode;
  if (opts.enableReasoning === false) return "off";
  if (opts.enableReasoning === true) return "on";
  return opts.defaultAuto ? "auto" : "on";
}

export type AiModelVendor = "openai" | "google";

/** How the model is meant to be used — thinking tokens in the chat picker. */
export type AiModelKind = "chat" | "reasoning";

/** Cost / role class — Flagship for chats, Worker for specialists and helpers. */
export type AiModelTier = "flagship" | "worker";

export type AiModelOption = {
  /**
   * Catalog key: `vendor/model` (auto route) or `vendor/model@prv_…`
   * when bound to a specific OpenAI-compatible provider.
   */
  id: string;
  label: string;
  vendor: AiModelVendor;
  kind: AiModelKind;
  tier: AiModelTier;
  contextWindow?: number;
};

/** OpenAI-compatible gateway (LiteLLM, OpenRouter, Ollama, …). */
export type AiProviderKind = "openaiCompatible";

export type AiProvider = {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  /** Optional extra HTTP headers (LiteLLM team/user keys, etc.). */
  headers?: Record<string, string>;
};

export type AiSettings = {
  /**
   * OpenAI-compatible gateways. Source of truth for gateway routing.
   * `openaiApiKey` / `baseUrl` mirror the default provider for legacy callers.
   */
  providers: AiProvider[];
  /** Which provider serves auto-routed models and IELTS OpenAI TTS/STT. */
  defaultProviderId: string | null;
  /**
   * Mirror of the default provider base URL (kept for migration / IELTS).
   * Prefer `providers` + `defaultProviderId` in new code.
   */
  baseUrl: string;
  /**
   * Mirror of the default provider API key.
   * Prefer `providers` + `defaultProviderId` in new code.
   */
  openaiApiKey: string;
  /** Direct Google AI API key — bypasses gateway when set. */
  googleApiKey: string;
  /**
   * Optional Tavily API key. When set, web_search / fetch_url / clip_article prefer Tavily;
   * otherwise free DuckDuckGo + Jina. Tools may override via provider.
   */
  tavilyApiKey: string;
  /** Optional OMDb API key for Media library lookup (English / Latin titles). */
  omdbApiKey: string;
  /** Optional Kinopoisk Unofficial API key — Russian titles + original name. */
  kinopoiskApiKey: string;
  /**
   * Optional Firecrawl API key for scrape_url and for clip_article when
   * provider=firecrawl is requested. Not used by fetch_url or default clip auto-pick.
   */
  firecrawlApiKey: string;
  /** Optional Deepgram key for IELTS Speaking STT. */
  deepgramApiKey: string;
  /** Optional ElevenLabs key for IELTS TTS. */
  elevenLabsApiKey: string;
  /** Optional Azure Speech key for pronunciation assessment. */
  azureSpeechKey: string;
  /** Azure Speech region, e.g. westeurope. */
  azureSpeechRegion: string;
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
  providers: [],
  defaultProviderId: null,
  baseUrl: OPENAI_BASE_URL,
  openaiApiKey: "",
  googleApiKey: "",
  tavilyApiKey: "",
  omdbApiKey: "",
  kinopoiskApiKey: "",
  firecrawlApiKey: "",
  deepgramApiKey: "",
  elevenLabsApiKey: "",
  azureSpeechKey: "",
  azureSpeechRegion: "",
  modelId: "openai/gpt-5.6-sol",
  defaultMode: "ask",
  agentMaxSteps: DEFAULT_AGENT_MAX_STEPS,
  agentTerminalEnabled: false,
  contextWindow: 200_000,
  models: [...OPENROUTER_MODELS],
};

/** Default (or first enabled) OpenAI-compatible provider. */
export function getDefaultProvider(
  settings: Pick<AiSettings, "providers" | "defaultProviderId">,
): AiProvider | null {
  const list = settings.providers ?? [];
  if (!list.length) return null;
  const byId = settings.defaultProviderId
    ? list.find((p) => p.id === settings.defaultProviderId)
    : undefined;
  if (byId?.enabled) return byId;
  return list.find((p) => p.enabled) ?? list[0] ?? null;
}

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
