import { resolveModelId } from "../ai/resolveModelId";
import { OPENROUTER_BASE_URL, OPENROUTER_MODELS } from "../ai/models";
import { stripVendorPrefix } from "../ai/languageModel";
import {
  lookupModelMeta,
  type ModelMetaMap,
} from "../ai/modelPrices";
import type {
  AiModelKind,
  AiModelOption,
  AiModelTier,
  AiModelVendor,
} from "../ai/types";

const VENDORS: AiModelVendor[] = ["openai", "google"];
const KINDS: AiModelKind[] = ["chat", "reasoning"];
const TIERS: AiModelTier[] = ["flagship", "worker"];

/** Same shape as vault AI model ids. */
export function isValidCatalogModelId(raw: string): boolean {
  const id = raw.trim();
  if (!id || id.length > 160 || !id.includes("/")) return false;
  if (!/^[\x21-\x7E]+$/.test(id) || /[<>"]/.test(id)) return false;
  return true;
}

export function vendorFromModelId(id: string): AiModelVendor {
  if (id.startsWith("google/")) return "google";
  return "openai";
}

/** Fallback when LiteLLM omits `supports_reasoning`. */
export function kindFromModelId(id: string): AiModelKind {
  if (
    /(^|\/)(gpt-4\.1|gpt-4o|gpt-5(\.\d+)?-chat|gpt-chat-latest)(-|$)/i.test(id)
  ) {
    return "chat";
  }
  if (/flash-lite/i.test(id)) return "chat";
  if (/\/(o[0-9]|gpt-5)/i.test(id)) return "reasoning";
  if (id.startsWith("google/")) return "reasoning";
  return "chat";
}

/** MarkSpace-only role class — not present in LiteLLM JSON. */
export function tierFromModelId(id: string): AiModelTier {
  if (/luna|flash-lite|(^|\/).*-mini(\b|$)/i.test(id)) return "worker";
  return "flagship";
}

/** Human label from bare model id (`gemini-3.8-flash` → `Gemini 3.8 Flash`). */
export function labelFromModelId(id: string): string {
  const bare = stripVendorPrefix(id.trim()) || id.trim();
  return bare
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      if (/^[a-z]+$/i.test(part) && part.length <= 3) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

export function coerceCatalogModel(raw: {
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
      : vendorFromModelId(id);
  const kind =
    typeof raw.kind === "string" && KINDS.includes(raw.kind as AiModelKind)
      ? (raw.kind as AiModelKind)
      : kindFromModelId(id);
  const tier =
    typeof raw.tier === "string" && TIERS.includes(raw.tier as AiModelTier)
      ? (raw.tier as AiModelTier)
      : tierFromModelId(id);
  return {
    id,
    label: raw.label.trim() || labelFromModelId(id),
    vendor,
    kind,
    tier,
    contextWindow:
      typeof raw.contextWindow === "number" && raw.contextWindow > 0
        ? Math.round(raw.contextWindow)
        : undefined,
  };
}

export function normalizeCatalogModels(
  models: AiModelOption[],
): AiModelOption[] {
  const mapped = models.map((m) =>
    coerceCatalogModel({
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
    if (m.id.startsWith("anthropic/") || (m.vendor as string) === "anthropic") {
      continue;
    }
    if (!m.id.includes("/")) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.length ? out : [...OPENROUTER_MODELS];
}

/**
 * User-owned catalog: empty/missing → curated seed; otherwise keep the user's
 * list (do not re-inject missing curated ids).
 */
export function mergeUserModels(
  rawModels: AiModelOption[] | null,
): AiModelOption[] {
  if (!rawModels?.length) return [...OPENROUTER_MODELS];
  return normalizeCatalogModels(rawModels);
}

export type EnrichModelResult = {
  model: AiModelOption;
  /** False when no LiteLLM meta row matched the id. */
  inMap: boolean;
};

/**
 * Build / refresh an `AiModelOption` from LiteLLM meta (prevails when present).
 * Tier stays MarkSpace heuristic; vendor from id prefix.
 */
export function enrichModelFromLiteLlm(
  modelId: string,
  meta: ModelMetaMap | null | undefined,
  opts?: { label?: string },
): EnrichModelResult {
  const id = resolveModelId(OPENROUTER_BASE_URL, modelId.trim());
  const hit = lookupModelMeta(id, meta);
  const kind: AiModelKind =
    hit?.supportsReasoning === true
      ? "reasoning"
      : hit?.supportsReasoning === false
        ? "chat"
        : kindFromModelId(id);
  const contextWindow =
    hit?.maxInputTokens != null && hit.maxInputTokens > 0
      ? Math.round(hit.maxInputTokens)
      : undefined;
  const label =
    (opts?.label?.trim() && opts.label.trim()) || labelFromModelId(id);
  return {
    inMap: hit != null,
    model: coerceCatalogModel({
      id,
      label,
      vendor: vendorFromModelId(id),
      kind,
      tier: tierFromModelId(id),
      contextWindow,
    }),
  };
}

export function enrichCatalogFromLiteLlm(
  models: AiModelOption[],
  meta: ModelMetaMap | null | undefined,
): AiModelOption[] {
  return normalizeCatalogModels(
    models.map((m) => {
      const { model } = enrichModelFromLiteLlm(m.id, meta, { label: m.label });
      return model;
    }),
  );
}
