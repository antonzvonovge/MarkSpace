/**
 * Catalog / thread model refs:
 * - `openai/gpt-5` — auto route (direct vendor key, else default gateway)
 * - `openai/gpt-5@prv_x7k2` — bound to a specific OpenAI-compatible provider
 *
 * The `@` suffix is only for MarkSpace routing. LiteLLM meta, vendor detection,
 * and prices always use `modelId` without the provider suffix.
 */

export type ParsedModelRef = {
  /** Catalog id without provider suffix (`openai/gpt-5`). */
  modelId: string;
  /** Bound provider id, or null for auto. */
  providerId: string | null;
};

const PROVIDER_ID_RE = /^prv_[a-zA-Z0-9]+$/;

/** True when the string looks like a stable provider id we generate. */
export function isProviderId(raw: string): boolean {
  return PROVIDER_ID_RE.test(raw.trim());
}

/**
 * Split a catalog/thread ref into model id + optional provider binding.
 * Bare ids and unknown `@` tails stay on the modelId side (no false splits).
 */
export function parseModelRef(ref: string): ParsedModelRef {
  const trimmed = (ref || "").trim();
  if (!trimmed) return { modelId: "", providerId: null };

  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return { modelId: trimmed, providerId: null };

  const modelId = trimmed.slice(0, at).trim();
  const providerId = trimmed.slice(at + 1).trim();
  if (!modelId || !isProviderId(providerId)) {
    return { modelId: trimmed, providerId: null };
  }
  return { modelId, providerId };
}

/** Build a catalog id; omit `@` when unbound (auto). */
export function formatModelRef(
  modelId: string,
  providerId: string | null | undefined,
): string {
  const id = modelId.trim();
  const pid = providerId?.trim() || null;
  if (!id) return "";
  if (!pid || !isProviderId(pid)) return id;
  return `${id}@${pid}`;
}

/** Generate a short stable provider id (`prv_` + random). */
export function createProviderId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `prv_${rand}`;
}
