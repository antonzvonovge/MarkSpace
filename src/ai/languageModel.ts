import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { JSONObject, SharedV4ProviderOptions } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { modelSupportsReasoning, VENDOR_LABEL } from "./models";
import { parseModelRef } from "./modelRef";
import { resolveModelId } from "./resolveModelId";
import type { AiModelVendor, AiProvider, AiSettings } from "./types";
import { getDefaultProvider } from "./types";
import { DEFAULT_WORKER_MODEL_ID } from "../lib/vaultAiSettings";
import {
  isOfficialOpenAiEndpoint,
  normalizeOpenAiBaseUrl,
  supportsMultiVendorGateway,
} from "../lib/openAiBaseUrl";
import { gatewayLlmFetch } from "./gatewayCostCapture";

export type AiProviderCredentials = {
  /** Mirrored default gateway key (legacy + IELTS). */
  openaiApiKey: string;
  /** Mirrored default gateway base URL. */
  openaiBaseUrl: string;
  googleApiKey: string;
  providers: AiProvider[];
  defaultProviderId: string | null;
};

export type ModelTransport = "direct" | "gateway";

export type ModelRoutePlan = {
  transport: ModelTransport;
  vendor: AiModelVendor;
  /** Full catalog ref (`openai/gpt-5` or `openai/gpt-5@prv_…`). */
  catalogModelId: string;
  /** Bare model id without `@prv_…` (used for vendor/heuristics). */
  bareModelId: string;
  /** Id passed to the chosen SDK. */
  providerModelId: string;
  /** Gateway provider used when transport is gateway; null for direct. */
  providerId: string | null;
  /** Display name of the gateway provider, when known. */
  providerName: string | null;
};

export type ResolvedLanguageModel = {
  model: LanguageModel;
  transport: ModelTransport;
  vendor: AiModelVendor;
  catalogModelId: string;
  providerModelId: string;
  providerId: string | null;
  /** Pass through to `streamText` / `generateText` when non-empty. */
  providerOptions?: SharedV4ProviderOptions;
};

function findProvider(
  keys: AiProviderCredentials,
  providerId: string | null | undefined,
): AiProvider | null {
  if (!providerId) return null;
  return keys.providers.find((p) => p.id === providerId) ?? null;
}

function gatewayFromKeys(keys: AiProviderCredentials): {
  apiKey: string;
  baseUrl: string;
  provider: AiProvider | null;
} {
  const def = getDefaultProvider({
    providers: keys.providers,
    defaultProviderId: keys.defaultProviderId,
  });
  if (def) {
    return {
      apiKey: def.apiKey.trim(),
      baseUrl: normalizeOpenAiBaseUrl(def.baseUrl),
      provider: def,
    };
  }
  return {
    apiKey: keys.openaiApiKey?.trim() ?? "",
    baseUrl: normalizeOpenAiBaseUrl(keys.openaiBaseUrl ?? ""),
    provider: null,
  };
}

export function credentialsFromSettings(
  settings: Pick<
    AiSettings,
    | "openaiApiKey"
    | "googleApiKey"
    | "baseUrl"
    | "providers"
    | "defaultProviderId"
  >,
): AiProviderCredentials {
  const providers = Array.isArray(settings.providers) ? settings.providers : [];
  const defaultProviderId = settings.defaultProviderId ?? null;
  const def = getDefaultProvider({ providers, defaultProviderId });
  return {
    openaiApiKey:
      def?.apiKey?.trim() || settings.openaiApiKey?.trim() || "",
    openaiBaseUrl: normalizeOpenAiBaseUrl(
      def?.baseUrl || settings.baseUrl || "",
    ),
    googleApiKey: settings.googleApiKey?.trim() ?? "",
    providers,
    defaultProviderId,
  };
}

export function hasAnyLlmCredentials(
  settings: Pick<
    AiSettings,
    | "openaiApiKey"
    | "googleApiKey"
    | "baseUrl"
    | "providers"
    | "defaultProviderId"
  >,
): boolean {
  const c = credentialsFromSettings(settings);
  if (c.googleApiKey) return true;
  if (c.openaiApiKey) return true;
  return c.providers.some((p) => p.enabled && p.apiKey.trim());
}

export function vendorFromModelId(modelId: string): AiModelVendor {
  const { modelId: bare } = parseModelRef(resolveModelId("", modelId));
  if (bare.startsWith("google/")) return "google";
  return "openai";
}

/** Strip `vendor/` prefix for direct provider APIs. */
export function stripVendorPrefix(catalogModelId: string): string {
  const { modelId } = parseModelRef(catalogModelId);
  const slash = modelId.indexOf("/");
  if (slash < 0) return modelId;
  return modelId.slice(slash + 1);
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
    case "openai": {
      // Direct OpenAI only when default gateway is the official endpoint.
      const gw = gatewayFromKeys(keys);
      if (isOfficialOpenAiEndpoint(gw.baseUrl) && gw.apiKey) return gw.apiKey;
      // Also allow a dedicated OpenAI provider that is not default.
      const official = keys.providers.find(
        (p) =>
          p.enabled &&
          p.apiKey.trim() &&
          isOfficialOpenAiEndpoint(p.baseUrl),
      );
      return official?.apiKey.trim() ?? "";
    }
    case "google":
      return keys.googleApiKey;
  }
}

/** True when the vendor key hits that provider's native API (not the OpenAI gateway field). */
function usesDirectProviderTransport(
  vendor: AiModelVendor,
  keys: AiProviderCredentials,
  /** Bound gateway refs never use direct transport. */
  boundProviderId: string | null,
): boolean {
  if (boundProviderId) return false;
  if (!directKeyForVendor(vendor, keys)) return false;
  if (vendor === "openai") {
    const gw = gatewayFromKeys(keys);
    if (!isOfficialOpenAiEndpoint(gw.baseUrl)) {
      // Direct only if some enabled provider is official OpenAI.
      return keys.providers.some(
        (p) =>
          p.enabled &&
          p.apiKey.trim() &&
          isOfficialOpenAiEndpoint(p.baseUrl),
      );
    }
  }
  return true;
}

export function missingCredentialsMessage(
  modelId: string,
  keys: AiProviderCredentials,
): string {
  const { providerId } = parseModelRef(modelId);
  if (providerId) {
    const p = findProvider(keys, providerId);
    if (!p) {
      return `Provider for this model was removed. Pick another model in the chat picker.`;
    }
    if (!p.enabled) {
      return `Provider “${p.name}” is disabled. Enable it in Settings → API keys.`;
    }
    if (!p.apiKey.trim()) {
      return `Add an API key for “${p.name}” in Settings → API keys`;
    }
  }
  const vendor = vendorFromModelId(modelId);
  const label = VENDOR_LABEL[vendor];
  const gw = gatewayFromKeys(keys);
  if (directKeyForVendor(vendor, keys)) {
    return `Add an API key in Settings → API keys`;
  }
  if (
    gw.apiKey &&
    !supportsMultiVendorGateway(gw.baseUrl) &&
    vendor !== "openai"
  ) {
    return `Add a ${label} API key in Settings → API keys, or set Base URL to an OpenAI-compatible gateway (LiteLLM, OpenRouter, …) that routes ${label} models.`;
  }
  if (!gw.apiKey) {
    return `Add a ${label} or OpenAI-compatible gateway API key in Settings → API keys`;
  }
  return `Add an API key in Settings → API keys`;
}

function gatewayProviderModelId(
  vendor: AiModelVendor,
  bareModelId: string,
): string {
  return vendor === "openai"
    ? toDirectProviderModelId("openai", bareModelId)
    : bareModelId;
}

/**
 * Choose transport: bound provider, else direct vendor key, else default gateway.
 * Pure — no SDK clients created.
 */
export function planModelRoute(
  modelId: string,
  keys: AiProviderCredentials,
): ModelRoutePlan {
  const catalogModelId = resolveModelId("", modelId);
  const { modelId: bareModelId, providerId: boundId } =
    parseModelRef(catalogModelId);
  const vendor = vendorFromModelId(bareModelId);

  if (boundId) {
    const provider = findProvider(keys, boundId);
    if (!provider) {
      throw new Error(missingCredentialsMessage(catalogModelId, keys));
    }
    if (!provider.enabled) {
      throw new Error(missingCredentialsMessage(catalogModelId, keys));
    }
    // Local servers may omit a key; require either a key or a non-official URL.
    const apiKey = provider.apiKey.trim();
    const baseUrl = normalizeOpenAiBaseUrl(provider.baseUrl);
    if (!apiKey && isOfficialOpenAiEndpoint(baseUrl)) {
      throw new Error(missingCredentialsMessage(catalogModelId, keys));
    }
    if (
      vendor !== "openai" &&
      !supportsMultiVendorGateway(baseUrl)
    ) {
      throw new Error(missingCredentialsMessage(catalogModelId, keys));
    }
    return {
      transport: "gateway",
      vendor,
      catalogModelId,
      bareModelId,
      providerModelId: gatewayProviderModelId(vendor, bareModelId),
      providerId: provider.id,
      providerName: provider.name,
    };
  }

  if (usesDirectProviderTransport(vendor, keys, null)) {
    return {
      transport: "direct",
      vendor,
      catalogModelId,
      bareModelId,
      providerModelId: toDirectProviderModelId(vendor, bareModelId),
      providerId: null,
      providerName: null,
    };
  }

  const gw = gatewayFromKeys(keys);
  if (gw.apiKey || (gw.provider && !isOfficialOpenAiEndpoint(gw.baseUrl))) {
    if (
      vendor !== "openai" &&
      !supportsMultiVendorGateway(gw.baseUrl)
    ) {
      throw new Error(missingCredentialsMessage(catalogModelId, keys));
    }
    if (!gw.apiKey && isOfficialOpenAiEndpoint(gw.baseUrl)) {
      throw new Error(missingCredentialsMessage(catalogModelId, keys));
    }
    return {
      transport: "gateway",
      vendor,
      catalogModelId,
      bareModelId,
      providerModelId: gatewayProviderModelId(vendor, bareModelId),
      providerId: gw.provider?.id ?? null,
      providerName: gw.provider?.name ?? null,
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

/**
 * Model for `run_specialist` workers.
 * When `useChatModel` is on, prefer the thread chat model.
 * Otherwise prefer the thread specialist model (vault Worker default).
 */
export function resolveSpecialistModelId(params: {
  keys: AiProviderCredentials;
  useChatModel: boolean;
  chatModelId?: string | null;
  specialistModelId?: string | null;
  fallbackModelId: string;
}): string {
  if (params.useChatModel) {
    const chat = params.chatModelId?.trim();
    if (chat) {
      return pickWorkerModelId({
        keys: params.keys,
        modelId: chat,
        fallbackModelId:
          params.specialistModelId?.trim() || params.fallbackModelId,
      });
    }
  }
  return pickWorkerModelId({
    keys: params.keys,
    modelId: params.specialistModelId?.trim() || undefined,
    fallbackModelId: params.fallbackModelId,
  });
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

type OpenAiClient = ReturnType<typeof createOpenAI>;

type CachedClient = {
  fingerprint: string;
  client: OpenAiClient;
};

const openAiClientCache = new Map<string, CachedClient>();

function clientFingerprint(
  apiKey: string,
  baseUrl: string,
  headers: Record<string, string> | undefined,
): string {
  const headerPart = headers
    ? Object.keys(headers)
        .sort()
        .map((k) => `${k}=${headers[k]}`)
        .join("&")
    : "";
  return `${baseUrl}|${apiKey}|${headerPart}`;
}

function resolveGatewayEndpoint(
  plan: ModelRoutePlan,
  keys: AiProviderCredentials,
): { apiKey: string; baseUrl: string; headers?: Record<string, string>; cacheKey: string } {
  if (plan.providerId) {
    const p = findProvider(keys, plan.providerId);
    if (p) {
      return {
        apiKey: p.apiKey.trim() || "no-key",
        baseUrl: normalizeOpenAiBaseUrl(p.baseUrl),
        headers: p.headers,
        cacheKey: p.id,
      };
    }
  }
  const gw = gatewayFromKeys(keys);
  return {
    apiKey: gw.apiKey || "no-key",
    baseUrl: gw.baseUrl,
    headers: gw.provider?.headers,
    cacheKey: gw.provider?.id ?? "default",
  };
}

function createOpenAiClientForEndpoint(opts: {
  cacheKey: string;
  apiKey: string;
  baseUrl: string;
  headers?: Record<string, string>;
}): OpenAiClient {
  const fingerprint = clientFingerprint(opts.apiKey, opts.baseUrl, opts.headers);
  const cached = openAiClientCache.get(opts.cacheKey);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.client;
  }
  const gateway = !isOfficialOpenAiEndpoint(opts.baseUrl);
  const client = createOpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl,
    headers: opts.headers,
    ...(gateway ? { fetch: gatewayLlmFetch() } : {}),
  });
  openAiClientCache.set(opts.cacheKey, { fingerprint, client });
  return client;
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
  endpoint: {
    apiKey: string;
    baseUrl: string;
    headers?: Record<string, string>;
    cacheKey: string;
  },
  providerModelId: string,
  opts?: { preferResponses?: boolean },
): LanguageModel {
  const openai = createOpenAiClientForEndpoint(endpoint);
  if (isOfficialOpenAiEndpoint(endpoint.baseUrl) || opts?.preferResponses) {
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
    case "openai": {
      // Prefer an official OpenAI provider entry; else mirrored default.
      const official = keys.providers.find(
        (p) =>
          p.enabled &&
          p.apiKey.trim() &&
          isOfficialOpenAiEndpoint(p.baseUrl),
      );
      const endpoint = official
        ? {
            apiKey: official.apiKey.trim(),
            baseUrl: normalizeOpenAiBaseUrl(official.baseUrl),
            headers: official.headers,
            cacheKey: official.id,
          }
        : {
            apiKey: keys.openaiApiKey,
            baseUrl: keys.openaiBaseUrl,
            cacheKey: "direct-openai",
          };
      return createOpenAiCompatibleModel(endpoint, providerModelId);
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
    params.enableReasoning ?? modelSupportsReasoning(plan.bareModelId);
  // Chat Completions + tools + reasoning_effort → 400 on gpt-5.x via LiteLLM.
  const preferResponses =
    plan.transport === "gateway" &&
    plan.vendor === "openai" &&
    Boolean(enableReasoning);

  let model: LanguageModel;
  if (plan.transport === "direct") {
    model = createDirectModel(plan.vendor, plan.providerModelId, params.keys);
  } else {
    const endpoint = resolveGatewayEndpoint(plan, params.keys);
    model = createOpenAiCompatibleModel(endpoint, plan.providerModelId, {
      preferResponses,
    });
  }

  return {
    model,
    transport: plan.transport,
    vendor: plan.vendor,
    catalogModelId: plan.catalogModelId,
    providerModelId: plan.providerModelId,
    providerId: plan.providerId,
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

/** Human-readable route for chat status (`Via name`, `Gateway · host`, or `Direct · Vendor`). */
export function modelRouteViaLabel(
  plan: Pick<
    ModelRoutePlan,
    "transport" | "vendor" | "providerName" | "providerId"
  >,
  baseUrl: string,
): string {
  if (plan.transport === "gateway") {
    if (plan.providerName?.trim()) {
      return `Via ${plan.providerName.trim()}`;
    }
    return `Gateway · ${gatewayTransportLabel(baseUrl)}`;
  }
  return `Direct · ${VENDOR_LABEL[plan.vendor]}`;
}
