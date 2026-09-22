import { create } from "zustand";
import {
  DEFAULT_FILE_MARKERS,
  catalogFromVaultFileMarkers,
  normalizeFileMarkerCatalog,
  type FileMarker,
} from "../lib/fileMarkers";
import {
  getFileMarkerSettings,
  setFileMarkerSettings,
} from "../lib/vaultApi";

type FileMarkerSettingsStore = {
  vaultPath: string | null;
  /** Effective catalog (defaults when the vault file is absent). */
  markers: FileMarker[];
  /** True when `.markspace/file-markers.json` has an explicit `markers` array. */
  customized: boolean;
  hydrated: boolean;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setMarkers: (markers: FileMarker[]) => Promise<void>;
  resetToDefaults: () => Promise<void>;
};

export const useFileMarkerSettingsStore = create<FileMarkerSettingsStore>(
  (set, get) => ({
    vaultPath: null,
    markers: DEFAULT_FILE_MARKERS.map((m) => ({ ...m })),
    customized: false,
    hydrated: false,

    hydrateForVault: async (vaultPath) => {
      if (!vaultPath) {
        set({
          vaultPath: null,
          markers: DEFAULT_FILE_MARKERS.map((m) => ({ ...m })),
          customized: false,
          hydrated: true,
        });
        return;
      }
      try {
        const doc = await getFileMarkerSettings();
        const customized = doc.markers != null;
        set({
          vaultPath,
          markers: catalogFromVaultFileMarkers(
            doc.markers == null
              ? null
              : normalizeFileMarkerCatalog(doc.markers),
          ),
          customized,
          hydrated: true,
        });
      } catch {
        set({
          vaultPath,
          markers: DEFAULT_FILE_MARKERS.map((m) => ({ ...m })),
          customized: false,
          hydrated: true,
        });
      }
    },

    setMarkers: async (markers) => {
      if (!get().vaultPath) return;
      const next = normalizeFileMarkerCatalog(markers);
      const doc = await setFileMarkerSettings(next);
      set({
        markers: catalogFromVaultFileMarkers(
          doc.markers == null
            ? null
            : normalizeFileMarkerCatalog(doc.markers),
        ),
        customized: doc.markers != null,
      });
    },

    resetToDefaults: async () => {
      await get().setMarkers(DEFAULT_FILE_MARKERS.map((m) => ({ ...m })));
    },
  }),
);
