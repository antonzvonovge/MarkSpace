import { create } from "zustand";
import {
  DEFAULT_DAY_MARKERS,
  catalogFromVaultMarkers,
  normalizeDayMarkerCatalog,
  type DayMarker,
} from "../lib/dayMarkers";
import { getDiarySettings, setDiarySettings } from "../lib/vaultApi";

type DiarySettingsStore = {
  vaultPath: string | null;
  /** Effective catalog (defaults when the vault file is absent). */
  markers: DayMarker[];
  /** True when `.markspace/diary.json` has an explicit `markers` array. */
  customized: boolean;
  hydrated: boolean;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setMarkers: (markers: DayMarker[]) => Promise<void>;
  resetToDefaults: () => Promise<void>;
};

export const useDiarySettingsStore = create<DiarySettingsStore>((set, get) => ({
  vaultPath: null,
  markers: DEFAULT_DAY_MARKERS.map((m) => ({ ...m })),
  customized: false,
  hydrated: false,

  hydrateForVault: async (vaultPath) => {
    if (!vaultPath) {
      set({
        vaultPath: null,
        markers: DEFAULT_DAY_MARKERS.map((m) => ({ ...m })),
        customized: false,
        hydrated: true,
      });
      return;
    }
    try {
      const doc = await getDiarySettings();
      const customized = doc.markers != null;
      set({
        vaultPath,
        markers: catalogFromVaultMarkers(
          doc.markers == null ? null : normalizeDayMarkerCatalog(doc.markers),
        ),
        customized,
        hydrated: true,
      });
    } catch {
      set({
        vaultPath,
        markers: DEFAULT_DAY_MARKERS.map((m) => ({ ...m })),
        customized: false,
        hydrated: true,
      });
    }
  },

  setMarkers: async (markers) => {
    if (!get().vaultPath) return;
    const next = normalizeDayMarkerCatalog(markers);
    const doc = await setDiarySettings(next);
    set({
      markers: catalogFromVaultMarkers(
        doc.markers == null ? null : normalizeDayMarkerCatalog(doc.markers),
      ),
      customized: doc.markers != null,
    });
  },

  resetToDefaults: async () => {
    await get().setMarkers(DEFAULT_DAY_MARKERS.map((m) => ({ ...m })));
  },
}));
