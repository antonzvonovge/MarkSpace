import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { JSONObject, SharedV4ProviderOptions } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { modelSupportsReasoning, VENDOR_LABEL } from "./models";
import { resolveModelId } from "./resolveModelId";
import type { AiModelVendor, AiSettings } from "./types";
import { DEFAULT_WORKER_MODEL_ID } from "../lib/vaultAiSettings";
import {
  isOfficialOpenAiEndpoint,
  normalizeOpenAiBaseUrl,
  supportsMultiVendorGateway,
} from "../lib/openAiBaseUrl";
import { gatewayLlmFetch } from "./gatewayCostCapture";

export type AiProviderCredentials = {
  openaiApiKey: string;
  openaiBaseUrl: string;
  googleApiKey: string;
};

export type ModelTransport = "direct" | "gateway";

export type ModelRoutePlan = {
  transport: ModelTransport;
  vendor: AiModelVendor;
  /** Catalog id with vendor prefix (`openai/gpt-5.6-sol`). */
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

export function credentialsFromSettings(
  settings: Pick<AiSettings, "openaiApiKey" | "googleApiKey" | "baseUrl">,
): AiProviderCredentials {
  return {
    openaiApiKey: settings.openaiApiKey?.trim() ?? "",
    openaiBaseUrl: normalizeOpenAiBaseUrl(settings.baseUrl ?? ""),
    googleApiKey: settings.googleApiKey?.trim() ?? "",
  };
}

export function hasAnyLlmCredentials(
  settings: Pick<AiSettings, "openaiApiKey" | "googleApiKey" | "baseUrl">,
): boolean {
  const c = credentialsFromSettings(settings);
  return !!(c.openaiApiKey || c.googleApiKey);
}

export function vendorFromModelId(modelId: string): AiModelVendor {
  const id = resolveModelId("", modelId);
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

/** Map catalog ids to native provider model ids. */
export function toDirectProviderModelId(
  _vendor: AiModelVendor,
  catalogModelId: string,
): string {
  return stripVendorPrefix(catalogModelId);
}

function directKeyForVendor(
  vendor: AiModelVendor,
  keys: AiProviderCredentials,
): string {
  switch (vendor) {
    case "openai":
      return keys.openaiApiKey;
    case "google":
      return keys.googleApiKey;
  }
}

/** True when the vendor key hits that provider's native API (not the OpenAI gateway field). */
function usesDirectProviderTransport(
  vendor: AiModelVendor,
  keys: AiProviderCredentials,
): boolean {
  if (!directKeyForVendor(vendor, keys)) return false;
  // openaiApiKey doubles as the gateway key — only direct on api.openai.com.
  if (vendor === "openai" && !isOfficialOpenAiEndpoint(keys.openaiBaseUrl)) {
    return false;
  }
  return true;
}

export function missingCredentialsMessage(
  modelId: string,
  keys: AiProviderCredentials,
): string {
  const vendor = vendorFromModelId(modelId);
  const label = VENDOR_LABEL[vendor];
  if (directKeyForVendor(vendor, keys)) {
    return `Add an API key in Settings → API keys`;
  }
  if (
    keys.openaiApiKey &&
    !supportsMultiVendorGateway(keys.openaiBaseUrl) &&
    vendor !== "openai"
  ) {
    return `Add a ${label} API key in Settings → API keys, or set Base URL to an OpenAI-compatible gateway (LiteLLM, OpenRouter, …) that routes ${label} models.`;
  }
  if (!keys.openaiApiKey) {
    return `Add a ${label} or OpenAI-compatible gateway API key in Settings → API keys`;
  }
  return `Add an API key in Settings → API keys`;
}

/**
 * Choose transport: direct provider key first, else OpenAI-compatible gateway.
 * Pure — no SDK clients created.
 */
export function planModelRoute(
  modelId: string,
  keys: AiProviderCredentials,
): ModelRoutePlan {
  const catalogModelId = resolveModelId("", modelId);
  const vendor = vendorFromModelId(catalogModelId);

  if (usesDirectProviderTransport(vendor, keys)) {
    return {
      transport: "direct",
      vendor,
      catalogModelId,
      providerModelId: toDirectProviderModelId(vendor, catalogModelId),
    };
  }

  if (keys.openaiApiKey) {
    if (
      vendor !== "openai" &&
      !supportsMultiVendorGateway(keys.openaiBaseUrl)
    ) {
      throw new Error(missingCredentialsMessage(catalogModelId, keys));
    }
    return {
      transport: "gateway",
      vendor,
      catalogModelId,
      providerModelId:
        vendor === "openai"
          ? toDirectProviderModelId("openai", catalogModelId)
          : catalogModelId,
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

export function resolveHelperModelIds(params: {
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
}): { primary: string; fallback?: string } {
  const primary = params.modelId?.trim() || DEFAULT_WORKER_MODEL_ID;
  const fallbackRaw = params.fallbackModelId?.trim();
  const fallback =
    fallbackRaw && fallbackRaw !== primary ? fallbackRaw : undefined;
  return { primary, fallback };
}

/** Worker id if credentials exist, otherwise chat fallback. */
export function pickWorkerModelId(params: {
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
}): string {
  const { primary, fallback } = resolveHelperModelIds(params);
  if (hasCredentialsForModel(primary, params.keys)) return primary;
  if (fallback && hasCredentialsForModel(fallback, params.keys)) return fallback;
  return primary;
}

export function assertHelperModelCredentials(params: {
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
}): void {
  const { primary, fallback } = resolveHelperModelIds(params);
  if (hasCredentialsForModel(primary, params.keys)) return;
  if (fallback && hasCredentialsForModel(fallback, params.keys)) return;
  throw new Error(missingCredentialsMessage(primary, params.keys));
}

export async function runWithModelFallback<T>(params: {
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  run: (modelId: string) => Promise<T>;
  isEmpty?: (value: T) => boolean;
}): Promise<T> {
  assertHelperModelCredentials(params);
  const { primary, fallback } = resolveHelperModelIds(params);
  const canPrimary = hasCredentialsForModel(primary, params.keys);

  if (canPrimary) {
    try {
      const result = await params.run(primary);
      if (!params.isEmpty?.(result)) return result;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (e instanceof Error && e.name === "AbortError") throw e;
      if (!fallback) throw e;
    }
  }

  if (fallback) {
    return await params.run(fallback);
  }

  return await params.run(primary);
}

function buildProviderOptions(
  plan: ModelRoutePlan,
  enableReasoning: boolean,
): SharedV4ProviderOptions | undefined {
  if (plan.transport === "gateway") {
    if (!enableReasoning || plan.vendor !== "openai") return undefined;
    return {
      openai: {
        parallelToolCalls: true,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
      },
    };
  }

  switch (plan.vendor) {
    case "openai": {
      const openai: JSONObject = { parallelToolCalls: true };
      if (enableReasoning) {
        openai.reasoningEffort = "medium";
        openai.reasoningSummary = "auto";
      }
      return { openai };
    }
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

function createOpenAiClient(keys: AiProviderCredentials) {
  const gateway = !isOfficialOpenAiEndpoint(keys.openaiBaseUrl);
  return createOpenAI({
    apiKey: keys.openaiApiKey,
    baseURL: keys.openaiBaseUrl,
    ...(gateway ? { fetch: gatewayLlmFetch() } : {}),
  });
}

/**
 * Official OpenAI defaults to the Responses API (`openai(id)`).
 * LiteLLM / OpenRouter / other OpenAI-compatible proxies usually only
 * implement Chat Completions — use `.chat()` there.
 *
 * Exception: OpenAI reasoning models reject `reasoning_effort` + function
 * tools on `/v1/chat/completions` (LiteLLM: use `/v1/responses` or
 * `reasoning_effort: none`). Prefer Responses when reasoning is enabled.
 */
function createOpenAiCompatibleModel(
  keys: AiProviderCredentials,
  providerModelId: string,
  opts?: { preferResponses?: boolean },
): LanguageModel {
  const openai = createOpenAiClient(keys);
  if (
    isOfficialOpenAiEndpoint(keys.openaiBaseUrl) ||
    opts?.preferResponses
  ) {
    return openai(providerModelId);
  }
  return openai.chat(providerModelId);
}

function createDirectModel(
  vendor: AiModelVendor,
  providerModelId: string,
  keys: AiProviderCredentials,
): LanguageModel {
  switch (vendor) {
    case "openai":
      return createOpenAiCompatibleModel(keys, providerModelId);
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
  // Chat Completions + tools + reasoning_effort → 400 on gpt-5.x via LiteLLM.
  const preferResponses =
    plan.transport === "gateway" &&
    plan.vendor === "openai" &&
    Boolean(enableReasoning);

  let model: LanguageModel;
  if (plan.transport === "direct") {
    model = createDirectModel(plan.vendor, plan.providerModelId, params.keys);
  } else {
    model = createOpenAiCompatibleModel(params.keys, plan.providerModelId, {
      preferResponses,
    });
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

export function gatewayTransportLabel(baseUrl: string): string {
  try {
    const host = new URL(normalizeOpenAiBaseUrl(baseUrl)).hostname;
    if (host.includes("openrouter.ai")) return "OpenRouter";
    if (host === "api.openai.com") return "OpenAI";
    return host || "Gateway";
  } catch {
    return "Gateway";
  }
}

/** Human-readable route for chat status (`Gateway · host` or `Direct · Vendor`). */
export function modelRouteViaLabel(
  plan: Pick<ModelRoutePlan, "transport" | "vendor">,
  baseUrl: string,
): string {
  if (plan.transport === "gateway") {
    return `Gateway · ${gatewayTransportLabel(baseUrl)}`;
  }
  return `Direct · ${VENDOR_LABEL[plan.vendor]}`;
}
