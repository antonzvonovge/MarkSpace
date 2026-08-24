import { useEffect } from "react";
import { useVaultAppearanceStore } from "../../store/vaultAppearanceStore";
import { useVaultStore } from "../../store/vaultStore";
import { RgbPicker } from "./RgbPicker";

export function AccentColorRow() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const hydrate = useVaultAppearanceStore((s) => s.hydrateForVault);
  const accentColor = useVaultAppearanceStore((s) => s.accentColor);
  const setAccentColor = useVaultAppearanceStore((s) => s.setAccentColor);

  useEffect(() => {
    void hydrate(vaultPath);
  }, [vaultPath, hydrate]);

  return (
    <div className="setting-row">
      <div className="setting-row-text">
        <div className="setting-row-label">Accent color</div>
        <div className="setting-row-desc">
          Highlight color for selections, focus rings, and UI chrome. Saved in
          this vault (<code>.markspace/appearance.json</code>).
        </div>
      </div>
      <div className="setting-row-control">
        <RgbPicker
          value={accentColor}
          ariaLabel="Accent color"
          disabled={!vaultPath}
          onChange={(hex) => {
            void setAccentColor(hex);
          }}
        />
      </div>
    </div>
  );
}
