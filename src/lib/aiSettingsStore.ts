import { Store } from "@tauri-apps/plugin-store";
import { resolveModelId } from "../ai/resolveModelId";
import { OPENROUTER_BASE_URL, OPENROUTER_MODELS } from "../ai/models";
import {
  DEFAULT_AI_SETTINGS,
  type AiSettings,
  type AiModelKind,
  type AiModelOption,
  type AiModelVendor,
  type ChatMode,
} from "../ai/types";

const STORE_FILE = "settings.json";
const AI_KEY = "ai";

const VENDORS: AiModelVendor[] = ["openai", "anthropic", "google"];
const KINDS: AiModelKind[] = ["chat", "reasoning"];

function vendorFromId(id: string): AiModelVendor {
  if (id.startsWith("anthropic/")) return "anthropic";
  if (id.startsWith("google/")) return "google";
  return "openai";
}

function kindFromId(id: string): AiModelKind {
  // Chat-only / non-reasoning OpenAI variants
  if (/(^|\/)(gpt-4\.1|gpt-4o|gpt-5(\.\d+)?-chat)(-|$)/i.test(id)) {
    return "chat";
  }
  if (/\/(o[0-9]|gpt-5)/i.test(id)) return "reasoning";
  if (id.startsWith("anthropic/") || id.startsWith("google/")) {
    return "reasoning";
  }
  return "chat";
}

function coerceModel(raw: {
  id: string;
  label: string;
  contextWindow?: number;
  vendor?: string;
  kind?: string;
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
  return {
    id,
    label: raw.label,
    vendor,
    kind,
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

/** Prefer curated catalog; keep unknown custom ids only if still OpenRouter-shaped. */
function mergeModels(rawModels: AiModelOption[] | null): AiModelOption[] {
  // Always ship the curated list as the primary catalog.
  const catalog = [...OPENROUTER_MODELS];
  if (!rawModels?.length) return catalog;

  const catalogIds = new Set(catalog.map((m) => m.id));
  // Preserve a previously selected custom OpenRouter id if user had one.
  for (const m of rawModels) {
    if (catalogIds.has(m.id)) continue;
    if (!m.id.includes("/")) continue;
    catalog.push(coerceModel(m));
  }
  return catalog;
}

function mergeAi(raw: Partial<AiSettings> | null | undefined): AiSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AI_SETTINGS };

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
    baseUrl: OPENROUTER_BASE_URL,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    modelId: known,
    defaultMode: mode,
    contextWindow:
      typeof raw.contextWindow === "number" && raw.contextWindow > 0
        ? Math.round(raw.contextWindow)
        : DEFAULT_AI_SETTINGS.contextWindow,
    models,
  };
}

export async function loadAiSettings(): Promise<AiSettings> {
  const store = await Store.load(STORE_FILE);
  const raw = await store.get<Partial<AiSettings>>(AI_KEY);
  const merged = mergeAi(raw);
  const changed =
    !raw ||
    raw.baseUrl !== merged.baseUrl ||
    raw.modelId !== merged.modelId ||
    JSON.stringify(raw.models ?? null) !== JSON.stringify(merged.models);
  if (changed) {
    await store.set(AI_KEY, merged);
    await store.save();
  }
  return merged;
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  const store = await Store.load(STORE_FILE);
  const normalized: AiSettings = {
    ...settings,
    baseUrl: OPENROUTER_BASE_URL,
    modelId: resolveModelId(OPENROUTER_BASE_URL, settings.modelId),
    models: normalizeModels(
      settings.models?.length ? settings.models : OPENROUTER_MODELS,
    ),
  };
  await store.set(AI_KEY, normalized);
  await store.save();
}
