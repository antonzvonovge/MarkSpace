import { Store } from "@tauri-apps/plugin-store";
import type { ModelPriceMap } from "../ai/modelPrices";

const STORE_FILE = "settings.json";
const PRICES_KEY = "litellmModelPrices";

export type ModelPricesCacheDoc = {
  fetchedAt: number;
  prices: ModelPriceMap;
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
  return { fetchedAt, prices };
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
  });
  await store.save();
}
