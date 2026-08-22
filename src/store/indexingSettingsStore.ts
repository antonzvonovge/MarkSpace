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
  type BackgroundPriority,
} from "../lib/vaultApi";

type IndexingSettingsStore = {
  vaultPath: string | null;
  enabled: boolean;
  delaySeconds: number;
  backgroundPriority: BackgroundPriority;
  hydrated: boolean;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setDelaySeconds: (delaySeconds: number) => Promise<void>;
  setBackgroundPriority: (priority: BackgroundPriority) => Promise<void>;
};

export const useIndexingSettingsStore = create<IndexingSettingsStore>(
  (set, get) => ({
    vaultPath: null,
    enabled: DEFAULT_INDEXING_SETTINGS.enabled,
    delaySeconds: DEFAULT_INDEXING_SETTINGS.delaySeconds,
    backgroundPriority: DEFAULT_INDEXING_SETTINGS.backgroundPriority,
    hydrated: false,

    hydrateForVault: async (vaultPath) => {
      if (!vaultPath) {
        set({
          vaultPath: null,
          enabled: DEFAULT_INDEXING_SETTINGS.enabled,
          delaySeconds: DEFAULT_INDEXING_SETTINGS.delaySeconds,
          backgroundPriority: DEFAULT_INDEXING_SETTINGS.backgroundPriority,
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
              backgroundPriority: fromRust.backgroundPriority,
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
          backgroundPriority: doc.backgroundPriority,
          hydrated: true,
        });
        await applyIndexingPolicy(doc);
      } catch {
        set({
          vaultPath,
          enabled: DEFAULT_INDEXING_SETTINGS.enabled,
          delaySeconds: DEFAULT_INDEXING_SETTINGS.delaySeconds,
          backgroundPriority: DEFAULT_INDEXING_SETTINGS.backgroundPriority,
          hydrated: true,
        });
      }
    },

    setEnabled: async (enabled) => {
      await commit(set, get, { enabled });
    },

    setDelaySeconds: async (delaySeconds) => {
      await commit(set, get, { delaySeconds });
    },

    setBackgroundPriority: async (backgroundPriority) => {
      await commit(set, get, { backgroundPriority });
    },
  }),
);

type Patch = Partial<
  Pick<
    IndexingSettingsStore,
    "enabled" | "delaySeconds" | "backgroundPriority"
  >
>;

async function commit(
  set: (patch: Patch) => void,
  get: () => IndexingSettingsStore,
  patch: Patch,
): Promise<void> {
  const state = get();
  if (!state.vaultPath) return;
  const doc = await saveIndexingSettings(state.vaultPath, {
    enabled: state.enabled,
    delaySeconds: state.delaySeconds,
    backgroundPriority: state.backgroundPriority,
    ...patch,
  });
  await applyIndexingPolicy(doc);
  set({
    enabled: doc.enabled,
    delaySeconds: doc.delaySeconds,
    backgroundPriority: doc.backgroundPriority,
  });
}
