import { stripVendorPrefix } from "./languageModel";

/** Same public map LiteLLM loads at startup. */
export const LITELLM_MODEL_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export type ModelPricePerMillion = {
  /** USD per 1M input tokens. */
  inPerM: number;
  /** USD per 1M output tokens. */
  outPerM: number;
};

export type ModelPriceMap = Record<string, ModelPricePerMillion>;

const PER_TOKEN_TO_PER_M = 1_000_000;

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/** Convert LiteLLM per-token USD to per-1M USD. */
export function perTokenToPerMillion(perToken: number): number {
  return perToken * PER_TOKEN_TO_PER_M;
}

/**
 * Slim LiteLLM's full pricing JSON down to input/output $/1M.
 * Skips `sample_spec` and entries without both cost fields.
 */
export function parseLiteLlmPriceMap(raw: unknown): ModelPriceMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ModelPriceMap = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "sample_spec") continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const inTok = asFiniteNumber(rec.input_cost_per_token);
    const outTok = asFiniteNumber(rec.output_cost_per_token);
    if (inTok == null || outTok == null) continue;
    out[key] = {
      inPerM: perTokenToPerMillion(inTok),
      outPerM: perTokenToPerMillion(outTok),
    };
  }
  return out;
}

/** Candidate LiteLLM keys for a MarkSpace catalog id (`openai/gpt-5.6-sol`). */
export function modelPriceLookupKeys(modelId: string): string[] {
  const id = modelId.trim();
  if (!id) return [];
  const bare = stripVendorPrefix(id);
  const keys = [id, bare];
  if (bare && bare !== id) {
    keys.push(`openai/${bare}`, `google/${bare}`, `gemini/${bare}`);
  }
  // Dedupe while preserving order.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const k of keys) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unique.push(k);
  }
  return unique;
}

export function lookupModelPrice(
  modelId: string,
  prices: ModelPriceMap | null | undefined,
): ModelPricePerMillion | null {
  if (!prices) return null;
  for (const key of modelPriceLookupKeys(modelId)) {
    const hit = prices[key];
    if (hit) return hit;
  }
  return null;
}

/** Compact number for `$4` / `$0.40` / `$1.6` style labels. */
export function formatPerMillionAmount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n >= 10) return String(Math.round(n));
  if (n >= 1) {
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }
  const rounded = Math.round(n * 100) / 100;
  if (rounded === 0 && n > 0) return n.toPrecision(1);
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

/** Compact pair for tight menu rows: `$4/$20`. */
export function formatPerMillionPair(price: ModelPricePerMillion): string {
  return `$${formatPerMillionAmount(price.inPerM)}/$${formatPerMillionAmount(price.outPerM)}`;
}

/** Tooltip / accessible label with full wording. */
export function formatPerMillionTitle(price: ModelPricePerMillion): string {
  const inn = formatPerMillionAmount(price.inPerM);
  const out = formatPerMillionAmount(price.outPerM);
  return `≈ $${inn} / $${out} per 1M tokens (LiteLLM estimate)`;
}
