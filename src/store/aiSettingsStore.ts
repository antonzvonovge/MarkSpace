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

export const useAiSettingsStore = create<AiSettingsStore>((set, get) => ({
  settings: { ...DEFAULT_AI_SETTINGS },
  hydrated: false,

  hydrate: async () => {
    const settings = await loadAiSettings();
    set({ settings, hydrated: true });
  },

  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    void saveAiSettings(settings);
  },

  updateSettings: (next) => {
    set({ settings: next });
    void saveAiSettings(next);
  },
}));

export type { ChatMode };
