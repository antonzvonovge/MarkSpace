import { create } from "zustand";
import {
  DEFAULT_ACCENT_HEX,
  applyAccentToElement,
  normalizeAccentHex,
} from "../lib/accentColor";
import { getVaultAppearance, setVaultAppearance } from "../lib/vaultApi";
import { peekAndClearLegacyAccentColor } from "../lib/settingsStore";

function paintAccent(hex: string) {
  applyAccentToElement(document.documentElement, hex);
}

type VaultAppearanceStore = {
  vaultPath: string | null;
  accentColor: string;
  hydrated: boolean;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setAccentColor: (hex: string) => Promise<void>;
};

export const useVaultAppearanceStore = create<VaultAppearanceStore>(
  (set, get) => ({
    vaultPath: null,
    accentColor: DEFAULT_ACCENT_HEX,
    hydrated: false,

    hydrateForVault: async (vaultPath) => {
      if (!vaultPath) {
        paintAccent(DEFAULT_ACCENT_HEX);
        set({
          vaultPath: null,
          accentColor: DEFAULT_ACCENT_HEX,
          hydrated: true,
        });
        return;
      }
      try {
        let doc = await getVaultAppearance();
        let hex = normalizeAccentHex(doc.accentColor);
        if (!doc.persisted) {
          const legacy = await peekAndClearLegacyAccentColor();
          if (legacy && legacy !== DEFAULT_ACCENT_HEX) {
            doc = await setVaultAppearance(legacy);
            hex = normalizeAccentHex(doc.accentColor);
          }
        }
        paintAccent(hex);
        set({ vaultPath, accentColor: hex, hydrated: true });
      } catch {
        paintAccent(DEFAULT_ACCENT_HEX);
        set({
          vaultPath,
          accentColor: DEFAULT_ACCENT_HEX,
          hydrated: true,
        });
      }
    },

    setAccentColor: async (hex) => {
      if (!get().vaultPath) return;
      const next = normalizeAccentHex(hex);
      paintAccent(next);
      set({ accentColor: next });
      const doc = await setVaultAppearance(next);
      const saved = normalizeAccentHex(doc.accentColor);
      paintAccent(saved);
      set({ accentColor: saved });
    },
  }),
);
