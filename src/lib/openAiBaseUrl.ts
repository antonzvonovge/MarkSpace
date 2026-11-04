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

function modelsAuthHeaders(
  apiKey: string,
  headers?: Record<string, string>,
): HeadersInit {
  const out: Record<string, string> = { ...(headers ?? {}) };
  const key = apiKey.trim();
  if (key) out.Authorization = `Bearer ${key}`;
  return out;
}

/** Probe credentials with a lightweight GET /models request. */
export async function verifyOpenAiCredentials(
  apiKey: string,
  baseUrl: string,
  headers?: Record<string, string>,
): Promise<VerifyOpenAiResult> {
  const key = apiKey.trim();
  // Local gateways (Ollama, LM Studio) often need no key.
  if (!key && isOfficialOpenAiEndpoint(baseUrl)) {
    return { ok: false, error: "API key is required." };
  }

  const base = normalizeOpenAiBaseUrl(baseUrl);
  try {
    const res = await fetch(`${base}/models`, {
      headers: modelsAuthHeaders(key, headers),
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

export type ListProviderModelsResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

/**
 * List model ids from an OpenAI-compatible `GET /models` endpoint.
 * Ids are returned as returned by the proxy (may be bare or `vendor/model`).
 */
export async function listProviderModels(
  apiKey: string,
  baseUrl: string,
  headers?: Record<string, string>,
): Promise<ListProviderModelsResult> {
  const base = normalizeOpenAiBaseUrl(baseUrl);
  try {
    const res = await fetch(`${base}/models`, {
      headers: modelsAuthHeaders(apiKey, headers),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Invalid API key." };
      }
      const body = (await res.text().catch(() => "")).trim();
      return {
        ok: false,
        error: body.slice(0, 240) || `HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of json.data ?? []) {
      if (typeof row?.id !== "string") continue;
      const id = row.id.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    ids.sort((a, b) => a.localeCompare(b));
    return { ok: true, ids };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Network error.",
    };
  }
}
