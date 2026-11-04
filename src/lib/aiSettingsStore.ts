import { Store } from "@tauri-apps/plugin-store";
import { resolveModelId } from "../ai/resolveModelId";
import {
  OPENAI_BASE_URL,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODELS,
} from "../ai/models";
import {
  DEFAULT_AI_SETTINGS,
  clampAgentMaxSteps,
  type AiSettings,
  type AiModelOption,
  type AiProvider,
  type ChatMode,
} from "../ai/types";
import { normalizeOpenAiBaseUrl } from "./openAiBaseUrl";
import {
  coerceCatalogModel,
  mergeUserModels,
  normalizeCatalogModels,
} from "./modelCatalog";
import {
  resolveProvidersFromRaw,
  syncDefaultProviderMirrors,
} from "./aiProviders";

const STORE_FILE = "settings.json";
const AI_KEY = "ai";

function resolveBaseUrl(
  raw: Partial<AiSettings> & { apiKey?: string } | null | undefined,
  migratedFromLegacyOpenRouter: boolean,
): string {
  if (typeof raw?.baseUrl === "string" && raw.baseUrl.trim()) {
    return normalizeOpenAiBaseUrl(raw.baseUrl);
  }
  if (migratedFromLegacyOpenRouter) {
    return OPENROUTER_BASE_URL;
  }
  return OPENAI_BASE_URL;
}

function resolveOpenAiApiKey(
  raw: Partial<AiSettings> & { apiKey?: string } | null | undefined,
): { openaiApiKey: string; migratedFromLegacyOpenRouter: boolean } {
  const openaiApiKey = stringField(raw, "openaiApiKey");
  const legacyOpenRouterKey =
    typeof raw?.apiKey === "string" ? raw.apiKey.trim() : "";
  if (openaiApiKey) {
    return { openaiApiKey, migratedFromLegacyOpenRouter: false };
  }
  if (legacyOpenRouterKey) {
    return {
      openaiApiKey: legacyOpenRouterKey,
      migratedFromLegacyOpenRouter: true,
    };
  }
  return { openaiApiKey: "", migratedFromLegacyOpenRouter: false };
}

function stringField(
  raw: Partial<AiSettings> | null | undefined,
  key: keyof AiSettings,
): string {
  const value = raw?.[key];
  return typeof value === "string" ? value : "";
}

function parseRawModels(
  raw: Partial<AiSettings> | null | undefined,
): AiModelOption[] | null {
  const rawList = Array.isArray(raw?.models) ? (raw.models as unknown[]) : null;
  if (!rawList) return null;
  return rawList
    .filter(
      (m): m is Record<string, unknown> & { id: string; label: string } =>
        !!m &&
        typeof m === "object" &&
        typeof (m as { id?: unknown }).id === "string" &&
        typeof (m as { label?: unknown }).label === "string",
    )
    .map((m) =>
      coerceCatalogModel({
        id: m.id,
        label: m.label,
        contextWindow:
          typeof m.contextWindow === "number" ? m.contextWindow : undefined,
        vendor: typeof m.vendor === "string" ? m.vendor : undefined,
        kind: typeof m.kind === "string" ? m.kind : undefined,
        tier: typeof m.tier === "string" ? m.tier : undefined,
      }),
    );
}

function providersEqual(a: AiProvider[], b: AiProvider[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.baseUrl !== y.baseUrl ||
      x.apiKey !== y.apiKey ||
      x.enabled !== y.enabled ||
      x.kind !== y.kind
    ) {
      return false;
    }
  }
  return true;
}

/** Normalize persisted / partial AI settings (exported for tests). */
export function normalizeAiSettings(
  raw: Partial<AiSettings> & { apiKey?: string } | null | undefined,
): AiSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AI_SETTINGS };

  const { openaiApiKey: legacyKey, migratedFromLegacyOpenRouter } =
    resolveOpenAiApiKey(raw);
  const legacyBaseUrl = resolveBaseUrl(raw, migratedFromLegacyOpenRouter);

  const {
    providers,
    defaultProviderId,
    openaiApiKey,
    baseUrl,
  } = resolveProvidersFromRaw(raw, legacyKey, legacyBaseUrl);

  const mode: ChatMode =
    raw.defaultMode === "agent" || raw.defaultMode === "ask"
      ? raw.defaultMode
      : DEFAULT_AI_SETTINGS.defaultMode;

  const models = mergeUserModels(parseRawModels(raw));
  const modelId = resolveModelId(
    OPENROUTER_BASE_URL,
    typeof raw.modelId === "string" && raw.modelId.trim()
      ? raw.modelId.trim()
      : DEFAULT_AI_SETTINGS.modelId,
  );
  const known = models.some((m) => m.id === modelId)
    ? modelId
    : (models[0]?.id ?? DEFAULT_AI_SETTINGS.modelId);

  return {
    providers,
    defaultProviderId,
    baseUrl,
    openaiApiKey,
    googleApiKey: stringField(raw, "googleApiKey"),
    tavilyApiKey: stringField(raw, "tavilyApiKey"),
    omdbApiKey: stringField(raw, "omdbApiKey"),
    kinopoiskApiKey: stringField(raw, "kinopoiskApiKey"),
    firecrawlApiKey: stringField(raw, "firecrawlApiKey"),
    deepgramApiKey: stringField(raw, "deepgramApiKey"),
    elevenLabsApiKey: stringField(raw, "elevenLabsApiKey"),
    azureSpeechKey: stringField(raw, "azureSpeechKey"),
    azureSpeechRegion: stringField(raw, "azureSpeechRegion"),
    modelId: known,
    defaultMode: mode,
    agentMaxSteps: clampAgentMaxSteps(raw.agentMaxSteps),
    agentTerminalEnabled: raw.agentTerminalEnabled === true,
    contextWindow:
      typeof raw.contextWindow === "number" && raw.contextWindow > 0
        ? Math.round(raw.contextWindow)
        : DEFAULT_AI_SETTINGS.contextWindow,
    models,
  };
}

/** Serialize settings.json AI reads/writes so a migrating load cannot clobber a concurrent save. */
let aiStoreChain: Promise<unknown> = Promise.resolve();

function withAiStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = aiStoreChain.then(fn, fn);
  aiStoreChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function buildPersistedAiSettings(settings: AiSettings): AiSettings {
  const normalized = normalizeAiSettings(settings);
  const mirrors = syncDefaultProviderMirrors({
    providers: settings.providers?.length
      ? settings.providers
      : normalized.providers,
    defaultProviderId:
      settings.defaultProviderId ?? normalized.defaultProviderId,
  });
  return {
    ...normalized,
    providers: settings.providers?.length
      ? settings.providers.map((p) => ({
          ...p,
          baseUrl: normalizeOpenAiBaseUrl(p.baseUrl),
          apiKey: p.apiKey ?? "",
          enabled: p.enabled !== false,
          kind: "openaiCompatible" as const,
        }))
      : normalized.providers,
    defaultProviderId:
      settings.defaultProviderId ?? normalized.defaultProviderId,
    baseUrl: mirrors.baseUrl,
    openaiApiKey: mirrors.openaiApiKey,
    googleApiKey: settings.googleApiKey ?? "",
    tavilyApiKey: settings.tavilyApiKey ?? "",
    omdbApiKey: settings.omdbApiKey ?? "",
    kinopoiskApiKey: settings.kinopoiskApiKey ?? "",
    firecrawlApiKey: settings.firecrawlApiKey ?? "",
    deepgramApiKey: settings.deepgramApiKey ?? "",
    elevenLabsApiKey: settings.elevenLabsApiKey ?? "",
    azureSpeechKey: settings.azureSpeechKey ?? "",
    azureSpeechRegion: settings.azureSpeechRegion ?? "",
    defaultMode:
      settings.defaultMode === "agent" || settings.defaultMode === "ask"
        ? settings.defaultMode
        : DEFAULT_AI_SETTINGS.defaultMode,
    agentMaxSteps: clampAgentMaxSteps(settings.agentMaxSteps),
    agentTerminalEnabled: settings.agentTerminalEnabled === true,
    modelId: resolveModelId(OPENROUTER_BASE_URL, settings.modelId),
    models: normalizeCatalogModels(
      settings.models?.length ? settings.models : OPENROUTER_MODELS,
    ),
  };
}

/** True when on-disk shape must be rewritten (not merely catalog/models refresh). */
export function aiSettingsNeedPersistRewrite(
  raw: Partial<AiSettings> & {
    apiKey?: string;
    anthropicApiKey?: string;
  } | null | undefined,
  merged: AiSettings,
): boolean {
  if (!raw) return true;
  const rawHadNoProviders =
    !Array.isArray(raw.providers) || raw.providers.length === 0;
  const migratedProviders =
    rawHadNoProviders && merged.providers.length > 0;
  return (
    raw.baseUrl !== merged.baseUrl ||
    raw.modelId !== merged.modelId ||
    raw.openaiApiKey !== merged.openaiApiKey ||
    raw.googleApiKey !== merged.googleApiKey ||
    raw.defaultProviderId !== merged.defaultProviderId ||
    migratedProviders ||
    (Array.isArray(raw.providers) &&
      !providersEqual(raw.providers as AiProvider[], merged.providers)) ||
    // Strip removed Anthropic key from on-disk settings.
    typeof raw.anthropicApiKey === "string" ||
    (typeof raw.apiKey === "string" &&
      raw.apiKey.trim() !== "" &&
      raw.openaiApiKey !== merged.openaiApiKey)
  );
}

export async function loadAiSettings(): Promise<AiSettings> {
  return withAiStoreLock(async () => {
    const store = await Store.load(STORE_FILE);
    const raw = await store.get<Partial<AiSettings>>(AI_KEY);
    const merged = normalizeAiSettings(raw);
    // Do not rewrite on models-catalog drift — that raced with key saves and could wipe secrets.
    if (aiSettingsNeedPersistRewrite(raw, merged)) {
      await store.set(AI_KEY, merged);
      await store.save();
    }
    return merged;
  });
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  return withAiStoreLock(async () => {
    const store = await Store.load(STORE_FILE);
    const normalized = buildPersistedAiSettings(settings);
    await store.set(AI_KEY, normalized);
    await store.save();
  });
}
