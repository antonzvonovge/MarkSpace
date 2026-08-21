import { create } from "zustand";
import {
  DEFAULT_INDEXING_SETTINGS,
  hasIndexingSettings,
  loadIndexingSettings,
  saveIndexingSettings,
} from "../lib/settingsStore";
import {
  clearLegacyIndexingSettings,
  getIndexingSettings,
  setIndexingSettings as applyIndexingPolicy,
} from "../lib/vaultApi";

type IndexingSettingsStore = {
  vaultPath: string | null;
  enabled: boolean;
  delaySeconds: number;
  hydrated: boolean;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setDelaySeconds: (delaySeconds: number) => Promise<void>;
};

export const useIndexingSettingsStore = create<IndexingSettingsStore>(
  (set, get) => ({
    vaultPath: null,
    enabled: DEFAULT_INDEXING_SETTINGS.enabled,
    delaySeconds: DEFAULT_INDEXING_SETTINGS.delaySeconds,
    hydrated: false,

    hydrateForVault: async (vaultPath) => {
      if (!vaultPath) {
        set({
          vaultPath: null,
          enabled: DEFAULT_INDEXING_SETTINGS.enabled,
          delaySeconds: DEFAULT_INDEXING_SETTINGS.delaySeconds,
          hydrated: true,
        });
        return;
      }
      try {
        let doc = await loadIndexingSettings(vaultPath);
        if (!(await hasIndexingSettings(vaultPath))) {
          try {
            const fromRust = await getIndexingSettings();
            doc = await saveIndexingSettings(vaultPath, {
              enabled: fromRust.enabled,
              delaySeconds: fromRust.delaySeconds,
            });
            await clearLegacyIndexingSettings();
          } catch {
            // keep defaults from loadIndexingSettings
          }
        }
        set({
          vaultPath,
          enabled: doc.enabled,
          delaySeconds: doc.delaySeconds,
          hydrated: true,
        });
        await applyIndexingPolicy({
          enabled: doc.enabled,
          delaySeconds: doc.delaySeconds,
        });
      } catch {
        set({
          vaultPath,
          enabled: DEFAULT_INDEXING_SETTINGS.enabled,
          delaySeconds: DEFAULT_INDEXING_SETTINGS.delaySeconds,
          hydrated: true,
        });
      }
    },

    setEnabled: async (enabled) => {
      const vaultPath = get().vaultPath;
      if (!vaultPath) return;
      const doc = await saveIndexingSettings(vaultPath, {
        enabled,
        delaySeconds: get().delaySeconds,
      });
      await applyIndexingPolicy({
        enabled: doc.enabled,
        delaySeconds: doc.delaySeconds,
      });
      set({ enabled: doc.enabled, delaySeconds: doc.delaySeconds });
    },

    setDelaySeconds: async (delaySeconds) => {
      const vaultPath = get().vaultPath;
      if (!vaultPath) return;
      const doc = await saveIndexingSettings(vaultPath, {
        enabled: get().enabled,
        delaySeconds,
      });
      await applyIndexingPolicy({
        enabled: doc.enabled,
        delaySeconds: doc.delaySeconds,
      });
      set({ enabled: doc.enabled, delaySeconds: doc.delaySeconds });
    },
  }),
);
