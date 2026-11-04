import { createProviderId } from "../ai/modelRef";
import { OPENAI_BASE_URL, OPENROUTER_BASE_URL } from "../ai/models";
import type { AiProvider, AiSettings } from "../ai/types";
import { getDefaultProvider } from "../ai/types";
import { normalizeOpenAiBaseUrl } from "./openAiBaseUrl";

export type ProviderPresetId =
  | "litellm"
  | "openrouter"
  | "openai"
  | "ollama"
  | "lmstudio"
  | "custom";

export type ProviderPreset = {
  id: ProviderPresetId;
  name: string;
  baseUrl: string;
  keyPlaceholder: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "litellm",
    name: "LiteLLM",
    baseUrl: "http://localhost:4000/v1",
    keyPlaceholder: "sk-…",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: OPENROUTER_BASE_URL,
    keyPlaceholder: "sk-or-…",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: OPENAI_BASE_URL,
    keyPlaceholder: "sk-…",
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    keyPlaceholder: "(optional)",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    keyPlaceholder: "(optional)",
  },
  {
    id: "custom",
    name: "Custom",
    baseUrl: "",
    keyPlaceholder: "sk-…",
  },
];

/** Human name from a base URL host (migration / default labels). */
export function providerNameFromBaseUrl(baseUrl: string): string {
  let host = "";
  try {
    host = new URL(normalizeOpenAiBaseUrl(baseUrl)).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (host.includes("openrouter.ai")) return "OpenRouter";
  if (host === "api.openai.com") return "OpenAI";
  if (/litellm/i.test(host) || /litellm/i.test(baseUrl)) return "LiteLLM";
  if (host === "localhost" || host === "127.0.0.1") {
    if (/11434/.test(baseUrl)) return "Ollama";
    if (/1234/.test(baseUrl)) return "LM Studio";
    return "Local gateway";
  }
  return host || "Gateway";
}

export function createProvider(
  patch: Partial<AiProvider> & Pick<AiProvider, "name" | "baseUrl">,
): AiProvider {
  return {
    id: patch.id?.trim() || createProviderId(),
    name: patch.name.trim() || "Gateway",
    kind: "openaiCompatible",
    baseUrl: normalizeOpenAiBaseUrl(patch.baseUrl),
    apiKey: patch.apiKey?.trim() ?? "",
    enabled: patch.enabled !== false,
    headers: patch.headers,
  };
}

/**
 * Build providers list from raw settings + legacy openaiApiKey/baseUrl.
 * Returns providers + default id + mirrored key/url.
 */
export function resolveProvidersFromRaw(
  raw: Partial<AiSettings> & { apiKey?: string } | null | undefined,
  openaiApiKey: string,
  baseUrl: string,
): {
  providers: AiProvider[];
  defaultProviderId: string | null;
  openaiApiKey: string;
  baseUrl: string;
} {
  const rawList = Array.isArray(raw?.providers) ? raw!.providers : null;
  let providers: AiProvider[] = [];

  if (rawList?.length) {
    providers = rawList
      .filter(
        (p): p is AiProvider =>
          !!p &&
          typeof p === "object" &&
          typeof p.id === "string" &&
          p.id.trim() !== "" &&
          typeof p.name === "string" &&
          typeof p.baseUrl === "string",
      )
      .map((p) =>
        createProvider({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          apiKey: typeof p.apiKey === "string" ? p.apiKey : "",
          enabled: p.enabled !== false,
          headers:
            p.headers && typeof p.headers === "object" ? p.headers : undefined,
        }),
      );
  }

  // Migrate legacy single gateway into a provider when none stored.
  if (!providers.length && openaiApiKey) {
    const migrated = createProvider({
      name: providerNameFromBaseUrl(baseUrl),
      baseUrl,
      apiKey: openaiApiKey,
      enabled: true,
    });
    providers = [migrated];
  }

  let defaultProviderId: string | null =
    typeof raw?.defaultProviderId === "string" && raw.defaultProviderId.trim()
      ? raw.defaultProviderId.trim()
      : null;

  if (defaultProviderId && !providers.some((p) => p.id === defaultProviderId)) {
    defaultProviderId = null;
  }
  if (!defaultProviderId && providers.length) {
    defaultProviderId = providers.find((p) => p.enabled)?.id ?? providers[0]!.id;
  }

  const def = getDefaultProvider({ providers, defaultProviderId });
  return {
    providers,
    defaultProviderId,
    openaiApiKey: def?.apiKey ?? openaiApiKey,
    baseUrl: def ? normalizeOpenAiBaseUrl(def.baseUrl) : baseUrl,
  };
}

/** Sync mirrored openaiApiKey/baseUrl from the default provider. */
export function syncDefaultProviderMirrors(
  settings: Pick<AiSettings, "providers" | "defaultProviderId">,
): { openaiApiKey: string; baseUrl: string } {
  const def = getDefaultProvider(settings);
  return {
    openaiApiKey: def?.apiKey ?? "",
    baseUrl: def
      ? normalizeOpenAiBaseUrl(def.baseUrl)
      : OPENAI_BASE_URL,
  };
}

/** Count catalog models bound to a provider (`…@providerId`). */
export function countModelsForProvider(
  models: { id: string }[],
  providerId: string,
): number {
  const suffix = `@${providerId}`;
  return models.filter((m) => m.id.endsWith(suffix)).length;
}
