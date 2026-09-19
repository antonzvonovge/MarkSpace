import { Store } from "@tauri-apps/plugin-store";
import type { ModelMetaMap, ModelPriceMap } from "../ai/modelPrices";

const STORE_FILE = "settings.json";
const PRICES_KEY = "litellmModelPrices";

export type ModelPricesCacheDoc = {
  fetchedAt: number;
  prices: ModelPriceMap;
  /** Present after metadata-aware fetches; missing → treat cache as stale. */
  meta: ModelMetaMap;
};

function isPriceEntry(v: unknown): v is { inPerM: number; outPerM: number } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return (
    typeof rec.inPerM === "number" &&
    Number.isFinite(rec.inPerM) &&
    rec.inPerM >= 0 &&
    typeof rec.outPerM === "number" &&
    Number.isFinite(rec.outPerM) &&
    rec.outPerM >= 0
  );
}

function isMetaEntry(
  v: unknown,
): v is { supportsReasoning: boolean | null; maxInputTokens: number | null } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  const sr = rec.supportsReasoning;
  const mit = rec.maxInputTokens;
  const srOk = sr === null || typeof sr === "boolean";
  const mitOk =
    mit === null ||
    (typeof mit === "number" && Number.isFinite(mit) && mit >= 0);
  return srOk && mitOk;
}

export function normalizeModelPricesCache(
  raw: unknown,
): ModelPricesCacheDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const fetchedAt =
    typeof rec.fetchedAt === "number" && Number.isFinite(rec.fetchedAt)
      ? rec.fetchedAt
      : NaN;
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
  const pricesRaw = rec.prices;
  if (!pricesRaw || typeof pricesRaw !== "object" || Array.isArray(pricesRaw)) {
    return null;
  }
  const prices: ModelPriceMap = {};
  for (const [key, entry] of Object.entries(
    pricesRaw as Record<string, unknown>,
  )) {
    if (!key || !isPriceEntry(entry)) continue;
    prices[key] = { inPerM: entry.inPerM, outPerM: entry.outPerM };
  }
  if (Object.keys(prices).length === 0) return null;

  // Old caches without meta must re-fetch.
  const metaRaw = rec.meta;
  if (!metaRaw || typeof metaRaw !== "object" || Array.isArray(metaRaw)) {
    return null;
  }
  const meta: ModelMetaMap = {};
  for (const [key, entry] of Object.entries(
    metaRaw as Record<string, unknown>,
  )) {
    if (!key || !isMetaEntry(entry)) continue;
    meta[key] = {
      supportsReasoning: entry.supportsReasoning,
      maxInputTokens: entry.maxInputTokens,
    };
  }
  if (Object.keys(meta).length === 0) return null;

  return { fetchedAt, prices, meta };
}

export async function loadModelPricesCache(): Promise<ModelPricesCacheDoc | null> {
  try {
    const store = await Store.load(STORE_FILE);
    const raw = await store.get<unknown>(PRICES_KEY);
    return normalizeModelPricesCache(raw);
  } catch {
    return null;
  }
}

export async function saveModelPricesCache(
  doc: ModelPricesCacheDoc,
): Promise<void> {
  const store = await Store.load(STORE_FILE);
  await store.set(PRICES_KEY, {
    fetchedAt: doc.fetchedAt,
    prices: doc.prices,
    meta: doc.meta,
  });
  await store.save();
}
