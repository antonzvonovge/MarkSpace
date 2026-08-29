import { create } from "zustand";
import {
  DEFAULT_AI_SETTINGS,
  type AiSettings,
  type ChatMode,
} from "../ai/types";
import { loadAiSettings, saveAiSettings } from "../lib/aiSettingsStore";

type AiSettingsStore = {
  settings: AiSettings;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setSettings: (patch: Partial<AiSettings>) => void;
  updateSettings: (next: AiSettings) => void;
};

/** Bumped on every local edit so a late hydrate cannot overwrite typed keys. */
let localAiWriteSeq = 0;

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
}));

export type { ChatMode };
