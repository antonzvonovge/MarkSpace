import { create } from "zustand";
import { formatModelRef, parseModelRef } from "../ai/modelRef";
import {
  DEFAULT_AI_SETTINGS,
  getDefaultProvider,
  type AiModelOption,
  type AiProvider,
  type AiSettings,
  type ChatMode,
} from "../ai/types";
import {
  createProvider,
  syncDefaultProviderMirrors,
} from "../lib/aiProviders";
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

type RemapModelsResult = {
  remapped: number;
  models: AiModelOption[];
};

type AiSettingsStore = {
  settings: AiSettings;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setSettings: (patch: Partial<AiSettings>) => void;
  updateSettings: (next: AiSettings) => void;
  setModels: (models: AiModelOption[]) => void;
  addModel: (
    modelId: string,
    providerId?: string | null,
  ) => Promise<AddModelResult>;
  addModels: (
    modelIds: string[],
    providerId: string | null,
  ) => Promise<{ added: number; skipped: number }>;
  removeModel: (modelId: string) => RemoveModelResult;
  setModelProvider: (
    modelId: string,
    providerId: string | null,
  ) => RemoveModelResult;
  refreshModelsFromLiteLlm: () => Promise<void>;
  upsertProvider: (provider: AiProvider) => void;
  addProvider: (
    patch: Partial<AiProvider> & Pick<AiProvider, "name" | "baseUrl">,
  ) => AiProvider;
  setDefaultProvider: (providerId: string) => void;
  setProviderEnabled: (providerId: string, enabled: boolean) => void;
  deleteProvider: (
    providerId: string,
    opts?: { remapToProviderId?: string | null },
  ) => RemapModelsResult;
};

/** Bumped on every local edit so a late hydrate cannot overwrite typed keys. */
let localAiWriteSeq = 0;

function persistSettings(settings: AiSettings) {
  localAiWriteSeq += 1;
  const mirrors = syncDefaultProviderMirrors(settings);
  const next = { ...settings, ...mirrors };
  useAiSettingsStore.setState({ settings: next });
  void saveAiSettings(next);
}

function persistModels(models: AiModelOption[]) {
  const settings = {
    ...useAiSettingsStore.getState().settings,
    models: normalizeCatalogModels(models),
  };
  // Keep app default modelId inside the catalog when possible.
  if (!settings.models.some((m) => m.id === settings.modelId)) {
    settings.modelId = settings.models[0]?.id ?? settings.modelId;
  }
  persistSettings(settings);
}

function remapCatalogModelIds(
  models: AiModelOption[],
  fromProviderId: string,
  toProviderId: string | null,
): { models: AiModelOption[]; remapped: number; idMap: Map<string, string> } {
  const suffix = `@${fromProviderId}`;
  const idMap = new Map<string, string>();
  let remapped = 0;
  const next: AiModelOption[] = [];
  const seen = new Set<string>();

  for (const m of models) {
    if (!m.id.endsWith(suffix)) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        next.push(m);
      }
      continue;
    }
    const { modelId } = parseModelRef(m.id);
    const newId = formatModelRef(modelId, toProviderId);
    idMap.set(m.id, newId);
    remapped += 1;
    if (seen.has(newId)) continue;
    seen.add(newId);
    next.push({ ...m, id: newId });
  }
  return { models: next, remapped, idMap };
}

function applyModelIdMap(idMap: Map<string, string>) {
  if (!idMap.size) return;
  const app = useAiSettingsStore.getState();
  const mappedDefault = idMap.get(app.settings.modelId);
  if (mappedDefault) {
    persistSettings({ ...app.settings, modelId: mappedDefault });
  }
  const vault = useVaultAiSettingsStore.getState();
  if (vault.doc.chatModelId && idMap.has(vault.doc.chatModelId)) {
    void vault.setChatModelId(idMap.get(vault.doc.chatModelId)!);
  }
  if (vault.doc.workerModelId && idMap.has(vault.doc.workerModelId)) {
    void vault.setWorkerModelId(idMap.get(vault.doc.workerModelId)!);
  }
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
    const settings = { ...get().settings, ...patch };
    persistSettings(settings);
  },

  updateSettings: (next) => {
    persistSettings(next);
  },

  setModels: (models) => {
    persistModels(models);
  },

  addModel: async (modelId, providerId) => {
    const trimmed = modelId.trim();
    if (!isValidCatalogModelId(trimmed)) {
      return {
        ok: false,
        error: "Use a vendor/model id (e.g. google/gemini-3.8-flash).",
      };
    }
    const { modelId: bare } = parseModelRef(trimmed);
    const boundId =
      providerId === undefined
        ? parseModelRef(trimmed).providerId
        : providerId;
    const catalogId = formatModelRef(bare, boundId);
    const existing = get().settings.models;
    if (existing.some((m) => m.id === catalogId)) {
      return { ok: false, error: "Model is already in the catalog." };
    }
    await useModelPricesStore.getState().ensureFresh();
    const meta = useModelPricesStore.getState().meta;
    const { model, inMap } = enrichModelFromLiteLlm(bare, meta, {
      providerId: boundId,
    });
    persistModels([...existing, model]);
    return { ok: true, model, inMap };
  },

  addModels: async (modelIds, providerId) => {
    await useModelPricesStore.getState().ensureFresh();
    const meta = useModelPricesStore.getState().meta;
    let existing = [...get().settings.models];
    let added = 0;
    let skipped = 0;
    for (const raw of modelIds) {
      const trimmed = raw.trim();
      if (!trimmed) {
        skipped += 1;
        continue;
      }
      // Accept bare ids from proxies; coerce via enrich + resolveModelId.
      let bare = parseModelRef(trimmed).modelId;
      if (!bare.includes("/")) {
        // Heuristic: google-ish vs openai
        if (/^gemini/i.test(bare)) bare = `google/${bare}`;
        else bare = `openai/${bare}`;
      }
      if (!isValidCatalogModelId(bare)) {
        skipped += 1;
        continue;
      }
      const catalogId = formatModelRef(bare, providerId);
      if (existing.some((m) => m.id === catalogId)) {
        skipped += 1;
        continue;
      }
      const { model } = enrichModelFromLiteLlm(bare, meta, {
        providerId,
      });
      existing.push(model);
      added += 1;
    }
    if (added) persistModels(existing);
    return { added, skipped };
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
      persistSettings({ ...app, modelId: fallback, models: next });
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

  setModelProvider: (modelId, providerId) => {
    const models = get().settings.models;
    const idx = models.findIndex((m) => m.id === modelId);
    if (idx < 0) return { ok: false, error: "Model is not in the catalog." };
    const { modelId: bare } = parseModelRef(modelId);
    const newId = formatModelRef(bare, providerId);
    if (newId !== modelId && models.some((m) => m.id === newId)) {
      return {
        ok: false,
        error: "That model is already bound to this provider.",
      };
    }
    const next = models.map((m, i) => (i === idx ? { ...m, id: newId } : m));
    persistModels(next);
    applyModelIdMap(new Map([[modelId, newId]]));
    return { ok: true };
  },

  refreshModelsFromLiteLlm: async () => {
    await useModelPricesStore.getState().forceRefresh();
    const meta = useModelPricesStore.getState().meta;
    const models = enrichCatalogFromLiteLlm(get().settings.models, meta);
    persistModels(models);
  },

  upsertProvider: (provider) => {
    const settings = get().settings;
    const providers = [...settings.providers];
    const idx = providers.findIndex((p) => p.id === provider.id);
    if (idx >= 0) providers[idx] = provider;
    else providers.push(provider);
    let defaultProviderId = settings.defaultProviderId;
    if (!defaultProviderId) defaultProviderId = provider.id;
    persistSettings({ ...settings, providers, defaultProviderId });
  },

  addProvider: (patch) => {
    const provider = createProvider(patch);
    const settings = get().settings;
    const providers = [...settings.providers, provider];
    const defaultProviderId =
      settings.defaultProviderId ?? provider.id;
    persistSettings({ ...settings, providers, defaultProviderId });
    return provider;
  },

  setDefaultProvider: (providerId) => {
    const settings = get().settings;
    if (!settings.providers.some((p) => p.id === providerId)) return;
    persistSettings({ ...settings, defaultProviderId: providerId });
  },

  setProviderEnabled: (providerId, enabled) => {
    const settings = get().settings;
    const providers = settings.providers.map((p) =>
      p.id === providerId ? { ...p, enabled } : p,
    );
    let defaultProviderId = settings.defaultProviderId;
    if (
      !enabled &&
      defaultProviderId === providerId
    ) {
      defaultProviderId =
        getDefaultProvider({
          providers: providers.filter((p) => p.id !== providerId || p.enabled),
          defaultProviderId: null,
        })?.id ?? null;
    }
    persistSettings({ ...settings, providers, defaultProviderId });
  },

  deleteProvider: (providerId, opts) => {
    const settings = get().settings;
    const providers = settings.providers.filter((p) => p.id !== providerId);
    let defaultProviderId = settings.defaultProviderId;
    if (defaultProviderId === providerId) {
      defaultProviderId =
        getDefaultProvider({ providers, defaultProviderId: null })?.id ?? null;
    }
    const remapTo =
      opts?.remapToProviderId === undefined
        ? null
        : opts.remapToProviderId;
    const { models, remapped, idMap } = remapCatalogModelIds(
      settings.models,
      providerId,
      remapTo,
    );
    persistSettings({
      ...settings,
      providers,
      defaultProviderId,
      models: normalizeCatalogModels(models),
    });
    applyModelIdMap(idMap);
    return { remapped, models };
  },
}));

export type { ChatMode, AddModelResult, RemoveModelResult };
