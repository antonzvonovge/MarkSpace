import { create } from "zustand";
import { applyPrefsToDom } from "../settings/applyPrefs";
import type { SettingCategory } from "../settings/registry";
import { DEFAULT_PREFS, type PrefKey, type Prefs } from "../settings/types";
import { loadPrefs, savePrefs } from "../lib/settingsStore";
import { useVaultStore } from "./vaultStore";

type PrefsStore = {
  prefs: Prefs;
  hydrated: boolean;
  settingsOpen: boolean;
  settingsCategory: SettingCategory;
  hydrate: () => Promise<void>;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
  openSettings: (category?: SettingCategory) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setSettingsCategory: (category: SettingCategory) => void;
};

function persistAndApply(prefs: Prefs) {
  applyPrefsToDom(prefs);
  void savePrefs(prefs);
}

export const usePrefsStore = create<PrefsStore>((set, get) => ({
  prefs: { ...DEFAULT_PREFS },
  hydrated: false,
  settingsOpen: false,
  settingsCategory: "appearance",

  hydrate: async () => {
    const prefs = await loadPrefs();
    applyPrefsToDom(prefs);
    useVaultStore.setState({ viewMode: prefs.defaultViewMode });
    set({ prefs, hydrated: true });
  },

  setPref: (key, value) => {
    const prefs = { ...get().prefs, [key]: value };
    set({ prefs });
    persistAndApply(prefs);
    if (key === "defaultViewMode") {
      useVaultStore.setState({ viewMode: value as Prefs["defaultViewMode"] });
    }
  },

  openSettings: (category) =>
    set({
      settingsOpen: true,
      ...(category ? { settingsCategory: category } : {}),
    }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => set({ settingsOpen: !get().settingsOpen }),
  setSettingsCategory: (category) => set({ settingsCategory: category }),
}));
