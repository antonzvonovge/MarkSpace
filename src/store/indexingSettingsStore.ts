import { create } from "zustand";
import {
  getIndexingSettings,
  setIndexingSettings,
  type IndexingSettings,
} from "../lib/vaultApi";

const DEFAULTS: IndexingSettings = {
  version: 1,
  enabled: true,
  delaySeconds: 5,
};

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
    enabled: DEFAULTS.enabled,
    delaySeconds: DEFAULTS.delaySeconds,
    hydrated: false,

    hydrateForVault: async (vaultPath) => {
      if (!vaultPath) {
        set({
          vaultPath: null,
          enabled: DEFAULTS.enabled,
          delaySeconds: DEFAULTS.delaySeconds,
          hydrated: true,
        });
        return;
      }
      try {
        const doc = await getIndexingSettings();
        set({
          vaultPath,
          enabled: doc.enabled,
          delaySeconds: doc.delaySeconds,
          hydrated: true,
        });
      } catch {
        set({
          vaultPath,
          enabled: DEFAULTS.enabled,
          delaySeconds: DEFAULTS.delaySeconds,
          hydrated: true,
        });
      }
    },

    setEnabled: async (enabled) => {
      if (!get().vaultPath) return;
      const doc = await setIndexingSettings({
        enabled,
        delaySeconds: get().delaySeconds,
      });
      set({ enabled: doc.enabled, delaySeconds: doc.delaySeconds });
    },

    setDelaySeconds: async (delaySeconds) => {
      if (!get().vaultPath) return;
      const clamped = Math.max(0, Math.min(300, Math.round(delaySeconds)));
      const doc = await setIndexingSettings({
        enabled: get().enabled,
        delaySeconds: clamped,
      });
      set({ enabled: doc.enabled, delaySeconds: doc.delaySeconds });
    },
  }),
);
