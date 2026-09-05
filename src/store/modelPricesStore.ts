import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  LITELLM_MODEL_PRICES_URL,
  parseLiteLlmPriceMap,
  type ModelPriceMap,
} from "../ai/modelPrices";
import {
  loadModelPricesCache,
  saveModelPricesCache,
} from "../lib/modelPricesCache";

/** Refresh when cache is older than this. */
export const MODEL_PRICES_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type HttpFetchResponse = {
  status: number;
  body: string;
};

type ModelPricesStore = {
  prices: ModelPriceMap;
  fetchedAt: number | null;
  hydrated: boolean;
  refreshing: boolean;
  /** Load disk cache; if missing/stale, fetch in background. */
  ensureFresh: () => Promise<void>;
};

let ensureInFlight: Promise<void> | null = null;
let fetchInFlight: Promise<void> | null = null;

function isStale(fetchedAt: number | null, now = Date.now()): boolean {
  if (fetchedAt == null || fetchedAt <= 0) return true;
  return now - fetchedAt >= MODEL_PRICES_TTL_MS;
}

async function fetchAndPersist(): Promise<void> {
  const res = await invoke<HttpFetchResponse>("http_fetch", {
    req: {
      url: LITELLM_MODEL_PRICES_URL,
      method: "GET",
      headers: null,
      body: null,
      timeoutSecs: 60,
    },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`LiteLLM prices HTTP ${res.status}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error("LiteLLM prices JSON parse failed");
  }
  const prices = parseLiteLlmPriceMap(parsed);
  if (Object.keys(prices).length === 0) {
    throw new Error("LiteLLM prices map empty");
  }
  const fetchedAt = Date.now();
  await saveModelPricesCache({ fetchedAt, prices });
  useModelPricesStore.setState({
    prices,
    fetchedAt,
    hydrated: true,
    refreshing: false,
  });
}

async function refreshInBackground(): Promise<void> {
  if (fetchInFlight) return fetchInFlight;
  useModelPricesStore.setState({ refreshing: true });
  fetchInFlight = (async () => {
    try {
      await fetchAndPersist();
    } catch (err) {
      // Keep existing cache; prices simply stay missing or stale.
      console.warn("[modelPrices] refresh failed", err);
      useModelPricesStore.setState({ refreshing: false });
    } finally {
      fetchInFlight = null;
    }
  })();
  return fetchInFlight;
}

export const useModelPricesStore = create<ModelPricesStore>((set, get) => ({
  prices: {},
  fetchedAt: null,
  hydrated: false,
  refreshing: false,

  ensureFresh: async () => {
    if (ensureInFlight) return ensureInFlight;
    ensureInFlight = (async () => {
      try {
        const state = get();
        if (!state.hydrated) {
          const cached = await loadModelPricesCache();
          if (cached) {
            set({
              prices: cached.prices,
              fetchedAt: cached.fetchedAt,
              hydrated: true,
            });
          } else {
            set({ hydrated: true });
          }
        }
        if (isStale(get().fetchedAt)) {
          const empty = Object.keys(get().prices).length === 0;
          // Empty cache: wait so the model picker can show prices on first open.
          if (empty) await refreshInBackground();
          else void refreshInBackground();
        }
      } finally {
        ensureInFlight = null;
      }
    })();
    return ensureInFlight;
  },
}));

/** Test helper — reset module locks + store. */
export function _resetModelPricesStoreForTests() {
  ensureInFlight = null;
  fetchInFlight = null;
  useModelPricesStore.setState({
    prices: {},
    fetchedAt: null,
    hydrated: false,
    refreshing: false,
  });
}
