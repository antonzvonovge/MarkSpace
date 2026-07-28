import { invoke } from "@tauri-apps/api/core";
import { tool } from "ai";
import { z } from "zod";
import { useAiSettingsStore } from "../store/aiSettingsStore";

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchProvider = "tavily" | "duckduckgo";
export type WebFetchProvider = "tavily" | "jina";

type HttpFetchResponse = {
  status: number;
  body: string;
};

/** CORS-free HTTP via Tauri/reqwest (webview fetch dies on DuckDuckGo/Jina). */
async function nativeFetch(opts: {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpFetchResponse> {
  return invoke<HttpFetchResponse>("http_fetch", {
    req: {
      url: opts.url,
      method: opts.method ?? "GET",
      headers: opts.headers ?? null,
      body: opts.body ?? null,
    },
  });
}

function tavilyApiKey(): string {
  return useAiSettingsStore.getState().settings.tavilyApiKey.trim();
}

function parseJsonBody<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function tavilyErrorDetail(body: string): string {
  const data = parseJsonBody<{
    detail?: { error?: string } | string;
    message?: string;
  }>(body);
  if (!data) return body.length < 300 ? body.trim() : "";
  if (typeof data.detail === "string") return data.detail;
  if (data.detail && typeof data.detail === "object" && data.detail.error) {
    return data.detail.error;
  }
  return data.message ?? (body.length < 300 ? body.trim() : "");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    );
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapDdgUrl(href: string): string {
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
  } catch {
    /* keep original */
  }
  return href;
}

function parseDuckDuckGoHtml(html: string, limit: number): WebSearchHit[] {
  if (/anomaly-modal|challenge-form|Unfortunately, bots/i.test(html)) {
    throw new Error(
      "DuckDuckGo blocked this request (bot check). Try again later or use fewer searches.",
    );
  }

  const blocks = html.match(
    /class="result results_links[\s\S]*?web-result[\s\S]*?(?=class="result results_links|class="nav-link|$)/g,
  );
  if (!blocks?.length) return [];

  const hits: WebSearchHit[] = [];
  for (const block of blocks) {
    if (hits.length >= limit) break;
    const link = block.match(
      /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!link) continue;
    const url = unwrapDdgUrl(link[1] ?? "");
    if (!url.startsWith("http")) continue;
    const title = stripTags(link[2] ?? "");
    if (!title) continue;
    const sn = block.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)/i,
    );
    hits.push({
      title,
      url,
      snippet: sn ? stripTags(sn[1] ?? "").slice(0, 400) : "",
    });
  }
  return hits;
}

/** Free DuckDuckGo HTML search — no API key. */
export async function searchDuckDuckGo(
  query: string,
  limit = 8,
): Promise<WebSearchHit[]> {
  const body = new URLSearchParams({ q: query }).toString();
  const res = await nativeFetch({
    url: "https://html.duckduckgo.com/html/",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`DuckDuckGo search failed: HTTP ${res.status}`);
  }
  return parseDuckDuckGoHtml(res.body, limit);
}

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
};

type TavilySearchResponse = {
  results?: TavilySearchResult[];
};

/** Tavily Search — used when tavilyApiKey is set. */
export async function searchTavily(
  query: string,
  apiKey: string,
  limit = 8,
): Promise<WebSearchHit[]> {
  const res = await nativeFetch({
    url: "https://api.tavily.com/search",
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(20, Math.max(1, limit)),
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (res.status < 200 || res.status >= 300) {
    const detail = tavilyErrorDetail(res.body);
    throw new Error(
      `Tavily search failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }

  const data = parseJsonBody<TavilySearchResponse>(res.body) ?? {};
  const hits: WebSearchHit[] = [];
  for (const r of data.results ?? []) {
    if (hits.length >= limit) break;
    const title = (r.title ?? "").trim();
    const href = (r.url ?? "").trim();
    if (!title || !href.startsWith("http")) continue;
    hits.push({
      title,
      url: href,
      snippet: (r.content ?? "").trim().slice(0, 800),
    });
  }
  return hits;
}

export async function webSearch(
  query: string,
  limit = 8,
): Promise<{ provider: WebSearchProvider; hits: WebSearchHit[] }> {
  const key = tavilyApiKey();
  if (key) {
    const hits = await searchTavily(query, key, limit);
    return { provider: "tavily", hits };
  }
  const hits = await searchDuckDuckGo(query, limit);
  return { provider: "duckduckgo", hits };
}

/** Free Jina Reader — URL → markdown. */
async function fetchViaJina(
  url: string,
  maxChars: number,
): Promise<{ url: string; content: string; truncated: boolean }> {
  const readerUrl = `https://r.jina.ai/${url}`;
  const res = await nativeFetch({
    url: readerUrl,
    method: "GET",
    headers: {
      Accept: "text/plain",
      "X-Return-Format": "markdown",
    },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Jina fetch failed: HTTP ${res.status}`);
  }
  const text = res.body;
  if (text.length > maxChars) {
    return { url, content: text.slice(0, maxChars), truncated: true };
  }
  return { url, content: text, truncated: false };
}

type TavilyExtractResponse = {
  results?: Array<{ url?: string; raw_content?: string | null }>;
  failed_results?: Array<{ url?: string; error?: string }>;
};

/** Tavily Extract — used when tavilyApiKey is set. */
export async function extractTavily(
  url: string,
  apiKey: string,
  maxChars = 24_000,
): Promise<{ url: string; content: string; truncated: boolean }> {
  const res = await nativeFetch({
    url: "https://api.tavily.com/extract",
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      urls: url,
      extract_depth: "basic",
      format: "markdown",
    }),
  });

  if (res.status < 200 || res.status >= 300) {
    const detail = tavilyErrorDetail(res.body);
    throw new Error(
      `Tavily extract failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }

  const data = parseJsonBody<TavilyExtractResponse>(res.body) ?? {};
  const failed = data.failed_results?.[0];
  if (failed?.error) {
    throw new Error(`Tavily extract failed: ${failed.error}`);
  }
  const result = data.results?.[0];
  const content = (result?.raw_content ?? "").trim();
  if (!content) {
    throw new Error("Tavily extract returned empty content");
  }
  const finalUrl = (result?.url ?? url).trim() || url;
  if (content.length > maxChars) {
    return {
      url: finalUrl,
      content: content.slice(0, maxChars),
      truncated: true,
    };
  }
  return { url: finalUrl, content, truncated: false };
}

export async function fetchUrlAsMarkdown(
  url: string,
  maxChars = 24_000,
): Promise<{
  url: string;
  content: string;
  truncated: boolean;
  provider: WebFetchProvider;
}> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }

  const normalized = parsed.toString();
  const key = tavilyApiKey();
  if (key) {
    const page = await extractTavily(normalized, key, maxChars);
    return { ...page, provider: "tavily" };
  }
  const page = await fetchViaJina(normalized, maxChars);
  return { ...page, provider: "jina" };
}

export function buildWebTools() {
  return {
    web_search: tool({
      description:
        "Search the public web. Returns titles, URLs, and short snippets. Use for facts, docs, news, or anything outside the vault. Follow up with fetch_url on promising links.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Web search query"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Max results (default 8)"),
      }),
      execute: async ({ query, limit }) => {
        try {
          const { provider, hits } = await webSearch(query, limit ?? 8);
          return {
            ok: true as const,
            provider,
            count: hits.length,
            hits,
          };
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    fetch_url: tool({
      description:
        "Fetch a web page and return readable markdown. Use after web_search when you need the full page, not just a snippet.",
      inputSchema: z.object({
        url: z.string().url().describe("http(s) URL to fetch"),
      }),
      execute: async ({ url }) => {
        try {
          const page = await fetchUrlAsMarkdown(url);
          return { ok: true as const, ...page };
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
  };
}
