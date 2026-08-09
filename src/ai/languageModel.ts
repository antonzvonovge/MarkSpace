import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { JSONObject, SharedV4ProviderOptions } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { modelSupportsReasoning, VENDOR_LABEL } from "./models";
import { resolveModelId } from "./resolveModelId";
import type { AiModelVendor, AiSettings } from "./types";

export type AiProviderCredentials = {
  openrouterApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  googleApiKey: string;
};

export type ModelTransport = "direct" | "openrouter";

export type ModelRoutePlan = {
  transport: ModelTransport;
  vendor: AiModelVendor;
  /** Catalog id with vendor prefix (`anthropic/claude-sonnet-4.6`). */
  catalogModelId: string;
  /** Id passed to the chosen SDK. */
  providerModelId: string;
};

export type ResolvedLanguageModel = {
  model: LanguageModel;
  transport: ModelTransport;
  vendor: AiModelVendor;
  catalogModelId: string;
  providerModelId: string;
  /** Pass through to `streamText` / `generateText` when non-empty. */
  providerOptions?: SharedV4ProviderOptions;
};

const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://markspace.app",
  "X-Title": "MarkSpace",
};

export function credentialsFromSettings(
  settings: Pick<
    AiSettings,
    "apiKey" | "openaiApiKey" | "anthropicApiKey" | "googleApiKey"
  >,
): AiProviderCredentials {
  return {
    openrouterApiKey: settings.apiKey?.trim() ?? "",
    openaiApiKey: settings.openaiApiKey?.trim() ?? "",
    anthropicApiKey: settings.anthropicApiKey?.trim() ?? "",
    googleApiKey: settings.googleApiKey?.trim() ?? "",
  };
}

export function hasAnyLlmCredentials(
  settings: Pick<
    AiSettings,
    "apiKey" | "openaiApiKey" | "anthropicApiKey" | "googleApiKey"
  >,
): boolean {
  const c = credentialsFromSettings(settings);
  return !!(
    c.openrouterApiKey ||
    c.openaiApiKey ||
    c.anthropicApiKey ||
    c.googleApiKey
  );
}

export function vendorFromModelId(modelId: string): AiModelVendor {
  const id = resolveModelId("", modelId);
  if (id.startsWith("anthropic/")) return "anthropic";
  if (id.startsWith("google/")) return "google";
  return "openai";
}

/** Strip `vendor/` prefix for direct provider APIs. */
export function stripVendorPrefix(catalogModelId: string): string {
  const id = catalogModelId.trim();
  const slash = id.indexOf("/");
  if (slash < 0) return id;
  return id.slice(slash + 1);
}

/**
 * Map OpenRouter-shaped catalog ids to native provider model ids.
 * Anthropic uses hyphens in version segments (`claude-sonnet-4-6`).
 */
export function toDirectProviderModelId(
  vendor: AiModelVendor,
  catalogModelId: string,
): string {
  const bare = stripVendorPrefix(catalogModelId);
  if (vendor === "anthropic") {
    return bare.replace(/\./g, "-");
  }
  return bare;
}

function directKeyForVendor(
  vendor: AiModelVendor,
  keys: AiProviderCredentials,
): string {
  switch (vendor) {
    case "openai":
      return keys.openaiApiKey;
    case "anthropic":
      return keys.anthropicApiKey;
    case "google":
      return keys.googleApiKey;
  }
}

export function missingCredentialsMessage(
  modelId: string,
  keys: AiProviderCredentials,
): string {
  const vendor = vendorFromModelId(modelId);
  const label = VENDOR_LABEL[vendor];
  if (!directKeyForVendor(vendor, keys) && !keys.openrouterApiKey) {
    return `Add a ${label} or OpenRouter API key in Settings → AI`;
  }
  return `Add an API key in Settings → AI`;
}

/**
 * Choose transport: direct provider key first, else OpenRouter fallback.
 * Pure — no SDK clients created.
 */
export function planModelRoute(
  modelId: string,
  keys: AiProviderCredentials,
): ModelRoutePlan {
  const catalogModelId = resolveModelId("", modelId);
  const vendor = vendorFromModelId(catalogModelId);
  const directKey = directKeyForVendor(vendor, keys);

  if (directKey) {
    return {
      transport: "direct",
      vendor,
      catalogModelId,
      providerModelId: toDirectProviderModelId(vendor, catalogModelId),
    };
  }

  if (keys.openrouterApiKey) {
    return {
      transport: "openrouter",
      vendor,
      catalogModelId,
      providerModelId: catalogModelId,
    };
  }

  throw new Error(missingCredentialsMessage(catalogModelId, keys));
}

export function hasCredentialsForModel(
  modelId: string,
  keys: AiProviderCredentials,
): boolean {
  try {
    planModelRoute(modelId, keys);
    return true;
  } catch {
    return false;
  }
}

function buildProviderOptions(
  plan: ModelRoutePlan,
  enableReasoning: boolean,
): SharedV4ProviderOptions | undefined {
  if (plan.transport === "openrouter") {
    if (!enableReasoning) return undefined;
    return {
      openrouter: {
        reasoning: {
          effort: "medium",
          exclude: false,
        },
      },
    };
  }

  switch (plan.vendor) {
    case "openai": {
      // Keep parallel tool calls on (OpenAI default, but be explicit).
      const openai: JSONObject = { parallelToolCalls: true };
      if (enableReasoning) {
        openai.reasoningEffort = "medium";
        openai.reasoningSummary = "auto";
      }
      return { openai };
    }
    case "anthropic":
      if (!enableReasoning) return undefined;
      return {
        anthropic: {
          thinking: {
            type: "enabled",
            budgetTokens: 10_000,
          },
        },
      };
    case "google":
      if (!enableReasoning) return undefined;
      return {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: "medium",
          },
        },
      };
  }
}

function createDirectModel(
  vendor: AiModelVendor,
  providerModelId: string,
  keys: AiProviderCredentials,
): LanguageModel {
  switch (vendor) {
    case "openai": {
      const openai = createOpenAI({ apiKey: keys.openaiApiKey });
      return openai(providerModelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: keys.anthropicApiKey });
      return anthropic(providerModelId);
    }
    case "google": {
      const google = createGoogle({ apiKey: keys.googleApiKey });
      return google(providerModelId);
    }
  }
}

export function resolveLanguageModel(params: {
  modelId: string;
  keys: AiProviderCredentials;
  /** When omitted, inferred from catalog `kind` / heuristics. */
  enableReasoning?: boolean;
}): ResolvedLanguageModel {
  const plan = planModelRoute(params.modelId, params.keys);
  const enableReasoning =
    params.enableReasoning ?? modelSupportsReasoning(plan.catalogModelId);

  let model: LanguageModel;
  if (plan.transport === "direct") {
    model = createDirectModel(plan.vendor, plan.providerModelId, params.keys);
  } else {
    const openrouter = createOpenRouter({
      apiKey: params.keys.openrouterApiKey,
      compatibility: "strict",
      headers: OPENROUTER_HEADERS,
    });
    model = openrouter(plan.providerModelId);
  }

  return {
    model,
    transport: plan.transport,
    vendor: plan.vendor,
    catalogModelId: plan.catalogModelId,
    providerModelId: plan.providerModelId,
    providerOptions: buildProviderOptions(plan, enableReasoning),
  };
}
