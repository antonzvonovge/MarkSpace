import { create } from "zustand";
import {
  DEFAULT_AI_SETTINGS,
  type AiModelOption,
  type AiSettings,
  type ChatMode,
} from "../ai/types";
import { loadAiSettings, saveAiSettings } from "../lib/aiSettingsStore";
import {
  enrichCatalogFromLiteLlm,
  enrichModelFromLiteLlm,
  isValidCatalogModelId,
  normalizeCatalogModels,
} from "../lib/modelCatalog";
import { useModelPricesStore } from "./modelPricesStore";
import { useVaultAiSettingsStore } from "./vaultAiSettingsStore";

type AddModelResult =
  | { ok: true; model: AiModelOption; inMap: boolean }
  | { ok: false; error: string };

type RemoveModelResult =
  | { ok: true }
  | { ok: false; error: string };

type AiSettingsStore = {
  settings: AiSettings;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setSettings: (patch: Partial<AiSettings>) => void;
  updateSettings: (next: AiSettings) => void;
  setModels: (models: AiModelOption[]) => void;
  addModel: (modelId: string) => Promise<AddModelResult>;
  removeModel: (modelId: string) => RemoveModelResult;
  refreshModelsFromLiteLlm: () => Promise<void>;
};

/** Bumped on every local edit so a late hydrate cannot overwrite typed keys. */
let localAiWriteSeq = 0;

function persistModels(models: AiModelOption[]) {
  localAiWriteSeq += 1;
  const settings = {
    ...useAiSettingsStore.getState().settings,
    models: normalizeCatalogModels(models),
  };
  // Keep app default modelId inside the catalog when possible.
  if (!settings.models.some((m) => m.id === settings.modelId)) {
    settings.modelId = settings.models[0]?.id ?? settings.modelId;
  }
  useAiSettingsStore.setState({ settings });
  void saveAiSettings(settings);
}

export const useAiSettingsStore = create<AiSettingsStore>((set, get) => ({
  settings: { ...DEFAULT_AI_SETTINGS },
  hydrated: false,

  hydrate: async () => {
    const seqAtStart = localAiWriteSeq;
    const settings = await loadAiSettings();
    if (localAiWriteSeq !== seqAtStart) {
      // User edited while disk load was in flight — keep memory, just mark ready.
      set({ hydrated: true });
      return;
    }
    set({ settings, hydrated: true });
  },

  setSettings: (patch) => {
    localAiWriteSeq += 1;
    const settings = { ...get().settings, ...patch };
    set({ settings });
    void saveAiSettings(settings);
  },

  updateSettings: (next) => {
    localAiWriteSeq += 1;
    set({ settings: next });
    void saveAiSettings(next);
  },

  setModels: (models) => {
    persistModels(models);
  },

  addModel: async (modelId) => {
    const trimmed = modelId.trim();
    if (!isValidCatalogModelId(trimmed)) {
      return {
        ok: false,
        error: "Use a vendor/model id (e.g. google/gemini-3.8-flash).",
      };
    }
    const existing = get().settings.models;
    if (existing.some((m) => m.id === trimmed)) {
      return { ok: false, error: "Model is already in the catalog." };
    }
    await useModelPricesStore.getState().ensureFresh();
    const meta = useModelPricesStore.getState().meta;
    const { model, inMap } = enrichModelFromLiteLlm(trimmed, meta);
    persistModels([...existing, model]);
    return { ok: true, model, inMap };
  },

  removeModel: (modelId) => {
    const models = get().settings.models;
    if (models.length <= 1) {
      return { ok: false, error: "Keep at least one model in the catalog." };
    }
    if (!models.some((m) => m.id === modelId)) {
      return { ok: false, error: "Model is not in the catalog." };
    }
    const next = models.filter((m) => m.id !== modelId);
    const fallback = next[0]!.id;
    persistModels(next);

    // Fix app default if it pointed at the removed id.
    const app = get().settings;
    if (app.modelId === modelId) {
      get().setSettings({ modelId: fallback });
    }

    // Fix vault chat/worker defaults when they pointed at the removed id.
    const vault = useVaultAiSettingsStore.getState();
    if (vault.doc.chatModelId === modelId) {
      void vault.setChatModelId(fallback);
    }
    if (vault.doc.workerModelId === modelId) {
      void vault.setWorkerModelId(fallback);
    }

    return { ok: true };
  },

  refreshModelsFromLiteLlm: async () => {
    await useModelPricesStore.getState().forceRefresh();
    const meta = useModelPricesStore.getState().meta;
    const models = enrichCatalogFromLiteLlm(get().settings.models, meta);
    persistModels(models);
  },
}));

export type { ChatMode, AddModelResult, RemoveModelResult };
