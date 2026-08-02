import { invoke } from "@tauri-apps/api/core";
import { tool } from "ai";
import { z } from "zod";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import {
  fetchTwitterStatusForClip,
  parseTwitterStatusUrl,
} from "./twitterArticle";

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchProvider = "tavily" | "duckduckgo";
/** Providers for ordinary fetch_url / clip_article (not Firecrawl scrape). */
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
  /** Seconds; Firecrawl scrapes often need longer than the 30s default. */
  timeoutSecs?: number;
}): Promise<HttpFetchResponse> {
  return invoke<HttpFetchResponse>("http_fetch", {
    req: {
      url: opts.url,
      method: opts.method ?? "GET",
      headers: opts.headers ?? null,
      body: opts.body ?? null,
      timeoutSecs: opts.timeoutSecs ?? null,
    },
  });
}

function tavilyApiKey(): string {
  return useAiSettingsStore.getState().settings.tavilyApiKey.trim();
}

function firecrawlApiKey(): string {
  return useAiSettingsStore.getState().settings.firecrawlApiKey.trim();
}

/** Auto provider for ordinary fetch_url / clip_article: Tavily → Jina. */
export function resolveWebFetchProvider(
  preferred?: WebFetchProvider,
): WebFetchProvider {
  if (preferred) return preferred;
  if (tavilyApiKey()) return "tavily";
  return "jina";
}

function firecrawlErrorDetail(body: string): string {
  const data = parseJsonBody<{
    error?: string;
    message?: string;
    code?: string;
  }>(body);
  if (!data) return body.length < 300 ? body.trim() : "";
  const parts = [data.error, data.message, data.code].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  return parts[0] ?? (body.length < 300 ? body.trim() : "");
}

function metaString(
  value: string | string[] | null | undefined,
): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }
  return null;
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

type FirecrawlScrapeResponse = {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string | null;
    images?: string[] | null;
    metadata?: {
      title?: string | string[] | null;
      description?: string | string[] | null;
      sourceURL?: string | null;
      url?: string | null;
      ogImage?: string | string[] | null;
      "og:image"?: string | string[] | null;
      image?: string | string[] | null;
    } | null;
  } | null;
};

export type FirecrawlScrapeResult = {
  url: string;
  content: string;
  truncated: boolean;
  /** Remote image URLs discovered by Firecrawl (for clip downloads). */
  imageUrls: string[];
};

/**
 * Firecrawl over-escapes punctuation in markdown (`https://x\.com`, `2026\-01\-01`).
 * Undo common escapes outside fenced/inline code.
 */
export function normalizeFirecrawlMarkdown(markdown: string): string {
  const parts = markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n");
    })
    .join("");
}

function collectFirecrawlImageUrls(
  data: NonNullable<FirecrawlScrapeResponse["data"]>,
  markdown: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    // Skip avatars / favicons / sprites — they crowd out article media.
    if (
      /profile_images|\/emoji\/|favicon|apple-touch-icon|\/sprites?\//i.test(
        url,
      )
    ) {
      return;
    }
    seen.add(url);
    out.push(url);
  };

  for (const m of markdown.matchAll(
    /!\[[^\]]*]\(\s*<?(https?:\/\/[^)\s>]+)>?\s*\)/gi,
  )) {
    push(m[1]);
  }
  for (const img of data.images ?? []) push(img);

  const meta = data.metadata;
  if (meta) {
    const candidates = [meta.ogImage, meta["og:image"], meta.image];
    for (const c of candidates) {
      if (Array.isArray(c)) c.forEach(push);
      else push(c);
    }
  }
  return out;
}

/** Merge remote image URLs into markdown so clip_article can download them. */
export function mergeImageUrlsIntoMarkdown(
  markdown: string,
  imageUrls: string[],
): string {
  if (!imageUrls.length) return markdown;
  const existing = new Set<string>();
  for (const m of markdown.matchAll(
    /!\[[^\]]*]\(\s*<?(https?:\/\/[^)\s>]+)>?\s*\)/gi,
  )) {
    if (m[1]) existing.add(m[1]);
  }
  const missing = imageUrls.filter((u) => !existing.has(u));
  if (!missing.length) return markdown;
  const block = missing
    .map((u, i) => `![image ${i + 1}](${u})`)
    .join("\n\n");
  return `${markdown.trim()}\n\n## Images\n\n${block}\n`;
}

/** Firecrawl /v2/scrape — browser-rendered page → markdown. */
export async function scrapeFirecrawl(
  url: string,
  apiKey: string,
  maxChars = 24_000,
  opts?: { forClip?: boolean },
): Promise<FirecrawlScrapeResult> {
  const forClip = opts?.forClip === true;
  const res = await nativeFetch({
    url: "https://api.firecrawl.dev/v2/scrape",
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: forClip ? ["markdown", "images"] : ["markdown"],
      onlyMainContent: true,
      // Keep payload small; recover http(s) images via the images format / og:image.
      removeBase64Images: true,
      timeout: 60_000,
    }),
    timeoutSecs: 90,
  });

  if (res.status < 200 || res.status >= 300) {
    const detail = firecrawlErrorDetail(res.body);
    throw new Error(
      `Firecrawl scrape failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }

  const data = parseJsonBody<FirecrawlScrapeResponse>(res.body);
  if (!data) {
    throw new Error("Firecrawl scrape returned invalid JSON");
  }
  if (data.success === false || data.error) {
    throw new Error(
      `Firecrawl scrape failed: ${data.error?.trim() || "unknown error"}`,
    );
  }

  let markdown = normalizeFirecrawlMarkdown(
    (data.data?.markdown ?? "").trim(),
  );
  if (!markdown) {
    throw new Error("Firecrawl scrape returned empty markdown");
  }

  const imageUrls = data.data
    ? collectFirecrawlImageUrls(data.data, markdown)
    : [];
  if (forClip && imageUrls.length) {
    markdown = mergeImageUrlsIntoMarkdown(markdown, imageUrls);
  }

  const meta = data.data?.metadata;
  const title = metaString(meta?.title);
  const finalUrl =
    (meta?.sourceURL ?? meta?.url ?? url).trim() || url;
  const withTitle = title ? `Title: ${title}\n\n${markdown}` : markdown;

  if (withTitle.length > maxChars) {
    return {
      url: finalUrl,
      content: withTitle.slice(0, maxChars),
      truncated: true,
      imageUrls,
    };
  }
  return {
    url: finalUrl,
    content: withTitle,
    truncated: false,
    imageUrls,
  };
}

export async function fetchUrlAsMarkdown(
  url: string,
  maxChars = 24_000,
  provider?: WebFetchProvider,
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

  // X/Twitter status URLs: Jina/Tavily often return empty or login walls.
  if (parseTwitterStatusUrl(normalized)) {
    try {
      const tw = await fetchTwitterStatusForClip(normalized);
      if (tw?.content.trim()) {
        let content = tw.content;
        if (tw.imageUrls.length) {
          content = mergeImageUrlsIntoMarkdown(content, tw.imageUrls);
        }
        if (content.length > maxChars) {
          return {
            url: tw.url,
            content: content.slice(0, maxChars),
            truncated: true,
            provider: resolveWebFetchProvider(provider),
          };
        }
        return {
          url: tw.url,
          content,
          truncated: tw.truncated,
          provider: resolveWebFetchProvider(provider),
        };
      }
    } catch {
      /* fall through to Tavily/Jina */
    }
  }

  const resolved = resolveWebFetchProvider(provider);

  if (resolved === "tavily") {
    const key = tavilyApiKey();
    if (!key) {
      throw new Error(
        "Tavily provider requested but no Tavily API key is set in AI settings",
      );
    }
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
        "Fetch a web page and return readable markdown. Use after web_search when you need the full page, not just a snippet. Auto-picks Tavily (if configured) or free Jina. x.com / twitter.com status URLs are fetched via FxTwitter (articles + media). For an explicit browser scrape, use scrape_url only when the user asks to scrape.",
      inputSchema: z.object({
        url: z.string().url().describe("http(s) URL to fetch"),
        provider: z
          .enum(["tavily", "jina"])
          .optional()
          .describe(
            "Fetch backend for non-Twitter URLs. Omit to auto-pick: Tavily when a key is set, otherwise Jina. Ignored for x.com/twitter.com status links (always FxTwitter).",
          ),
      }),
      execute: async ({ url, provider }) => {
        try {
          const page = await fetchUrlAsMarkdown(url, 24_000, provider);
          return { ok: true as const, ...page };
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    scrape_url: tool({
      description:
        "Browser-scrape a URL via Firecrawl and return clean markdown. ONLY use when the user explicitly asks to scrape / Firecrawl a page (or names scrape_url). Do NOT use for ordinary reading, search follow-ups, or clipping — prefer fetch_url or clip_article. Whether Firecrawl is configured is stated in the system prompt — do not ask the user about the API key first.",
      inputSchema: z.object({
        url: z.string().url().describe("http(s) URL to scrape"),
      }),
      execute: async ({ url }) => {
        try {
          let parsed: URL;
          try {
            parsed = new URL(url);
          } catch {
            return { ok: false as const, error: "Invalid URL" };
          }
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return {
              ok: false as const,
              error: "Only http(s) URLs are allowed",
            };
          }
          const key = firecrawlApiKey();
          if (!key) {
            return {
              ok: false as const,
              error:
                "No Firecrawl API key is set. Add one in Settings → Firecrawl API key.",
            };
          }
          const page = await scrapeFirecrawl(parsed.toString(), key, 100_000);
          return {
            ok: true as const,
            provider: "firecrawl" as const,
            ...page,
          };
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
