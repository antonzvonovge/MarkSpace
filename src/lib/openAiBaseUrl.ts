import { OPENAI_BASE_URL } from "../ai/models";

/** Trim trailing slashes; fall back to the official OpenAI endpoint. */
export function normalizeOpenAiBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed || OPENAI_BASE_URL;
}

/** Official OpenAI API — accepts OpenAI model ids only, not `vendor/model` catalog ids. */
export function isOfficialOpenAiEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(normalizeOpenAiBaseUrl(baseUrl)).hostname.toLowerCase();
    return host === "api.openai.com";
  } catch {
    return false;
  }
}

/**
 * Whether the configured base URL can route non-OpenAI catalog ids
 * (e.g. `google/gemini-…` via OpenRouter or LiteLLM).
 */
export function supportsMultiVendorGateway(baseUrl: string): boolean {
  return !isOfficialOpenAiEndpoint(baseUrl);
}

export type VerifyOpenAiResult =
  | { ok: true }
  | { ok: false; error: string };

/** Probe credentials with a lightweight GET /models request. */
export async function verifyOpenAiCredentials(
  apiKey: string,
  baseUrl: string,
): Promise<VerifyOpenAiResult> {
  const key = apiKey.trim();
  if (!key) {
    return { ok: false, error: "API key is required." };
  }

  const base = normalizeOpenAiBaseUrl(baseUrl);
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Invalid API key." };
    }
    const body = (await res.text().catch(() => "")).trim();
    return {
      ok: false,
      error: body.slice(0, 240) || `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Network error.",
    };
  }
}
