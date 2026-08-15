import { generateText } from "ai";
import { sanitizeTagName } from "../lib/tagName";
import {
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";
import { fetchUrlAsMarkdown } from "./webTools";

/** Cheap model for link metadata — same class as chat titles. */
export type SuggestLinkMetaResult = {
  description: string;
  tags: string[];
};

export type SuggestLinkMetaParams = {
  url: string;
  /** Existing vault + file tags — prefer these exact names. */
  tagCatalog: string[];
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
};

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error("Model did not return JSON");
  }
}

function normalizeDescription(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTags(raw: unknown, catalog: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const catalogByLower = new Map(
    catalog.map((t) => [t.trim().toLowerCase(), t.trim()] as const),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    let name = sanitizeTagName(item);
    if (!name) continue;
    const fromCatalog = catalogByLower.get(name.toLowerCase());
    if (fromCatalog) name = fromCatalog;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 6) break;
  }
  return out;
}

function buildSystem(tagCatalog: string[]): string {
  const catalogLine =
    tagCatalog.length > 0
      ? `Existing tags (prefer these exact strings when they fit): ${JSON.stringify(tagCatalog)}`
      : "No existing tags yet — invent 1–4 short lowercase tags (latin or nested with /).";
  return `You help fill metadata for a bookmark in a notes app.
Reply with JSON only, no markdown fences: {"description":"...","tags":["..."]}
- description: one short Russian sentence (max ~160 chars) about what the page is. No quotes around the whole string beyond JSON.
- tags: 1–5 tags. Prefer exact names from the existing catalog when relevant. You may add a few new short tags if needed.
- Tag syntax: never use spaces. Write multi-word tags in kebab-case (e.g. "model-context-protocol"), lowercase, only letters/digits/-/_//.
${catalogLine}`;
}

export async function suggestLinkMeta(
  params: SuggestLinkMetaParams,
): Promise<SuggestLinkMetaResult> {
  const url = params.url.trim();
  if (!url) throw new Error("URL is required");

  const page = await fetchUrlAsMarkdown(url, 12_000);
  if (params.abortSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const catalog = params.tagCatalog
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 80);

  const prompt = `URL: ${page.url}\n\nPage content (markdown):\n${page.content}`;

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: buildSystem(catalog),
      prompt,
      maxOutputTokens: 280,
      temperature: 0.3,
      abortSignal: params.abortSignal,
    });
    const parsed = extractJsonObject(text) as {
      description?: unknown;
      tags?: unknown;
    };
    return {
      description: normalizeDescription(parsed.description),
      tags: normalizeTags(parsed.tags, catalog),
    };
  };

  return await runWithModelFallback({
    keys: params.keys,
    modelId: params.modelId,
    fallbackModelId: params.fallbackModelId,
    run: tryModel,
  });
}
