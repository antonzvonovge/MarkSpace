import { create } from "zustand";
import { applyPrefsToDom } from "../settings/applyPrefs";
import type { SettingCategory } from "../settings/registry";
import { DEFAULT_PREFS, type PrefKey, type Prefs } from "../settings/types";
import { loadPrefs, savePrefs } from "../lib/settingsStore";
import { SETTINGS_TAB_PATH, useVaultStore } from "./vaultStore";

type PrefsStore = {
  prefs: Prefs;
  hydrated: boolean;
  settingsCategory: SettingCategory;
  hydrate: () => Promise<void>;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
  /** Open (or focus) the settings tab, optionally jumping to a category. */
  openSettings: (category?: SettingCategory) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setSettingsCategory: (category: SettingCategory) => void;
};

/** True while the settings tab is the active editor tab. */
export function useSettingsTabActive(): boolean {
  return useVaultStore((s) => s.activePath === SETTINGS_TAB_PATH);
}

function persistAndApply(prefs: Prefs) {
  applyPrefsToDom(prefs);
  void savePrefs(prefs);
}

export const usePrefsStore = create<PrefsStore>((set, get) => ({
  prefs: { ...DEFAULT_PREFS },
  hydrated: false,
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

  openSettings: (category) => {
    if (category) set({ settingsCategory: category });
    void useVaultStore.getState().openSettingsTab();
  },
  closeSettings: () => {
    void useVaultStore.getState().closeTab(SETTINGS_TAB_PATH);
  },
  toggleSettings: () => {
    if (useVaultStore.getState().activePath === SETTINGS_TAB_PATH) {
      get().closeSettings();
      return;
    }
    get().openSettings();
  },
  setSettingsCategory: (category) => set({ settingsCategory: category }),
}));
