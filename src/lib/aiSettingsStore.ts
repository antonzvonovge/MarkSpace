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
  type AiModelKind,
  type AiModelOption,
  type AiModelTier,
  type AiModelVendor,
  type ChatMode,
} from "../ai/types";
import { normalizeOpenAiBaseUrl } from "./openAiBaseUrl";

const STORE_FILE = "settings.json";
const AI_KEY = "ai";

const VENDORS: AiModelVendor[] = ["openai", "google"];
const KINDS: AiModelKind[] = ["chat", "reasoning"];
const TIERS: AiModelTier[] = ["flagship", "worker"];

function vendorFromId(id: string): AiModelVendor {
  if (id.startsWith("google/")) return "google";
  return "openai";
}

function kindFromId(id: string): AiModelKind {
  // Chat-only / non-reasoning OpenAI variants + light Google Flash
  if (
    /(^|\/)(gpt-4\.1|gpt-4o|gpt-5(\.\d+)?-chat|gpt-chat-latest)(-|$)/i.test(id)
  ) {
    return "chat";
  }
  if (/flash-lite/i.test(id)) return "chat";
  if (/\/(o[0-9]|gpt-5)/i.test(id)) return "reasoning";
  if (id.startsWith("google/")) {
    return "reasoning";
  }
  return "chat";
}

function tierFromId(id: string): AiModelTier {
  if (/luna|flash-lite|(^|\/).*-mini(\b|$)/i.test(id)) return "worker";
  return "flagship";
}

function coerceModel(raw: {
  id: string;
  label: string;
  contextWindow?: number;
  vendor?: string;
  kind?: string;
  tier?: string;
}): AiModelOption {
  const id = resolveModelId(OPENROUTER_BASE_URL, raw.id);
  const vendor =
    typeof raw.vendor === "string" &&
    VENDORS.includes(raw.vendor as AiModelVendor)
      ? (raw.vendor as AiModelVendor)
      : vendorFromId(id);
  const kind =
    typeof raw.kind === "string" && KINDS.includes(raw.kind as AiModelKind)
      ? (raw.kind as AiModelKind)
      : kindFromId(id);
  const tier =
    typeof raw.tier === "string" && TIERS.includes(raw.tier as AiModelTier)
      ? (raw.tier as AiModelTier)
      : tierFromId(id);
  return {
    id,
    label: raw.label,
    vendor,
    kind,
    tier,
    contextWindow:
      typeof raw.contextWindow === "number" && raw.contextWindow > 0
        ? Math.round(raw.contextWindow)
        : undefined,
  };
}

function normalizeModels(models: AiModelOption[]): AiModelOption[] {
  const mapped = models.map((m) =>
    coerceModel({
      id: m.id,
      label: m.label,
      contextWindow: m.contextWindow,
      vendor: m.vendor,
      kind: m.kind,
      tier: m.tier,
    }),
  );
  const seen = new Set<string>();
  const out: AiModelOption[] = [];
  for (const m of mapped) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.length ? out : [...OPENROUTER_MODELS];
}

/** Prefer curated catalog; keep unknown custom ids only if still vendor/model-shaped. */
function mergeModels(rawModels: AiModelOption[] | null): AiModelOption[] {
  // Always ship the curated list as the primary catalog.
  const catalog = [...OPENROUTER_MODELS];
  if (!rawModels?.length) return catalog;

  const catalogIds = new Set(catalog.map((m) => m.id));
  // Preserve a previously selected custom id if user had one.
  for (const m of rawModels) {
    if (catalogIds.has(m.id)) continue;
    if (!m.id.includes("/")) continue;
    // Drop removed Anthropic catalog / BYOK entries.
    if (m.id.startsWith("anthropic/") || (m.vendor as string) === "anthropic")
      continue;
    catalog.push(coerceModel(m));
  }
  return catalog;
}

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

/** Normalize persisted / partial AI settings (exported for tests). */
export function normalizeAiSettings(
  raw: Partial<AiSettings> & { apiKey?: string } | null | undefined,
): AiSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AI_SETTINGS };

  const { openaiApiKey, migratedFromLegacyOpenRouter } =
    resolveOpenAiApiKey(raw);
  const baseUrl = resolveBaseUrl(raw, migratedFromLegacyOpenRouter);

  const rawList = Array.isArray(raw.models) ? (raw.models as unknown[]) : null;
  const rawModels = rawList
    ? rawList
        .filter(
          (m): m is Record<string, unknown> & { id: string; label: string } =>
            !!m &&
            typeof m === "object" &&
            typeof (m as { id?: unknown }).id === "string" &&
            typeof (m as { label?: unknown }).label === "string",
        )
        .map((m) =>
          coerceModel({
            id: m.id,
            label: m.label,
            contextWindow:
              typeof m.contextWindow === "number"
                ? m.contextWindow
                : undefined,
            vendor: typeof m.vendor === "string" ? m.vendor : undefined,
            kind: typeof m.kind === "string" ? m.kind : undefined,
            tier: typeof m.tier === "string" ? m.tier : undefined,
          }),
        )
    : null;

  const mode: ChatMode =
    raw.defaultMode === "agent" || raw.defaultMode === "ask"
      ? raw.defaultMode
      : DEFAULT_AI_SETTINGS.defaultMode;

  const models = normalizeModels(mergeModels(rawModels));
  const modelId = resolveModelId(
    OPENROUTER_BASE_URL,
    typeof raw.modelId === "string" && raw.modelId.trim()
      ? raw.modelId.trim()
      : DEFAULT_AI_SETTINGS.modelId,
  );
  const known = models.some((m) => m.id === modelId)
    ? modelId
    : DEFAULT_AI_SETTINGS.modelId;

  return {
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
  return {
    ...normalizeAiSettings(settings),
    // Preserve keys/mode from the in-memory object after normalize defaults.
    baseUrl: normalizeOpenAiBaseUrl(settings.baseUrl ?? OPENAI_BASE_URL),
    openaiApiKey: settings.openaiApiKey ?? "",
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
    models: normalizeModels(
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
  return (
    raw.baseUrl !== merged.baseUrl ||
    raw.modelId !== merged.modelId ||
    raw.openaiApiKey !== merged.openaiApiKey ||
    raw.googleApiKey !== merged.googleApiKey ||
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
