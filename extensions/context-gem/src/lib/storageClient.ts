import { normalizeSettings } from "./storage";
import type { ExtensionSettings, PanelGeometry } from "./types";

/** Content scripts cannot use chrome.storage — proxy via background. */
export async function loadSettingsInPage(): Promise<ExtensionSettings> {
  const response = (await chrome.runtime.sendMessage({
    type: "GET_SETTINGS",
  })) as { settings?: Partial<ExtensionSettings> } | undefined;

  return normalizeSettings(response?.settings);
}

export async function loadPanelGeometryInPage(): Promise<PanelGeometry | null> {
  const response = (await chrome.runtime.sendMessage({
    type: "GET_PANEL_GEOMETRY",
  })) as { geometry?: PanelGeometry | null } | undefined;

  const geometry = response?.geometry;
  if (
    !geometry ||
    typeof geometry.top !== "number" ||
    typeof geometry.left !== "number" ||
    typeof geometry.width !== "number" ||
    typeof geometry.height !== "number"
  ) {
    return null;
  }
  return geometry;
}

export async function savePanelGeometryInPage(
  geometry: PanelGeometry,
): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "SAVE_PANEL_GEOMETRY",
    geometry,
  });
}
