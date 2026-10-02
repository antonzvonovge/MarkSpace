import { create } from "zustand";
import {
  loadDashboardsEnabled,
  saveDashboardsEnabled,
} from "../lib/settingsStore";

type DashboardEnabledStore = {
  enabled: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
};

export const useDashboardEnabledStore = create<DashboardEnabledStore>(
  (set, get) => ({
    enabled: false,
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return;
      try {
        const enabled = await loadDashboardsEnabled();
        if (get().hydrated) return;
        set({ enabled, hydrated: true });
      } catch {
        if (get().hydrated) return;
        set({ enabled: false, hydrated: true });
      }
    },

    setEnabled: (enabled) => {
      set({ enabled, hydrated: true });
      void saveDashboardsEnabled(enabled);
    },
  }),
);

/** True only after the app setting is loaded and the user turned dashboards on. */
export function useDashboardsLive(): boolean {
  return useDashboardEnabledStore((s) => s.hydrated && s.enabled);
}
