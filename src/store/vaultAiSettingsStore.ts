import { create } from "zustand";
import {
  effectiveChatModelId,
  effectiveWorkerModelId,
  EMPTY_VAULT_AI_SETTINGS,
  normalizeVaultAiSettings,
  type VaultAiSettings,
} from "../lib/vaultAiSettings";
import { getVaultAiSettings, setVaultAiSettings } from "../lib/vaultApi";
import { useAiSettingsStore } from "./aiSettingsStore";

type VaultAiSettingsStore = {
  vaultPath: string | null;
  doc: VaultAiSettings;
  hydrated: boolean;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setChatModelId: (modelId: string) => Promise<void>;
  setWorkerModelId: (modelId: string) => Promise<void>;
};

export const useVaultAiSettingsStore = create<VaultAiSettingsStore>((set, get) => ({
  vaultPath: null,
  doc: { ...EMPTY_VAULT_AI_SETTINGS },
  hydrated: false,

  hydrateForVault: async (vaultPath) => {
    if (!vaultPath) {
      set({
        vaultPath: null,
        doc: { ...EMPTY_VAULT_AI_SETTINGS },
        hydrated: true,
      });
      return;
    }
    try {
      const raw = await getVaultAiSettings();
      set({
        vaultPath,
        doc: normalizeVaultAiSettings(raw),
        hydrated: true,
      });
    } catch {
      set({
        vaultPath,
        doc: { ...EMPTY_VAULT_AI_SETTINGS },
        hydrated: true,
      });
    }
  },

  setChatModelId: async (modelId) => {
    if (!get().vaultPath) return;
    const workerModelId = effectiveWorkerModelId(get().doc);
    const raw = await setVaultAiSettings({
      chatModelId: modelId,
      workerModelId,
    });
    set({ doc: normalizeVaultAiSettings(raw) });
  },

  setWorkerModelId: async (modelId) => {
    if (!get().vaultPath) return;
    const appModelId = useAiSettingsStore.getState().settings.modelId;
    const chatModelId = effectiveChatModelId(get().doc, appModelId);
    const raw = await setVaultAiSettings({
      chatModelId,
      workerModelId: modelId,
    });
    set({ doc: normalizeVaultAiSettings(raw) });
  },
}));

/** Worker + chat fallback for helpers and specialists. */
export function helperModelCallParams(): {
  modelId: string;
  fallbackModelId: string;
} {
  const appModelId = useAiSettingsStore.getState().settings.modelId;
  const doc = useVaultAiSettingsStore.getState().doc;
  return {
    modelId: effectiveWorkerModelId(doc),
    fallbackModelId: effectiveChatModelId(doc, appModelId),
  };
}

export function vaultChatModelId(): string {
  const appModelId = useAiSettingsStore.getState().settings.modelId;
  return effectiveChatModelId(
    useVaultAiSettingsStore.getState().doc,
    appModelId,
  );
}
