export type ThemeId = "light" | "dark";
export type UiDensityId = "comfortable" | "compact";
export type EditorFontFamilyId = "sans" | "mono";
export type ViewModePref = "live" | "source";

export type Prefs = {
  theme: ThemeId;
  uiDensity: UiDensityId;
  uiFontSize: number;
  liveFontSize: number;
  liveFontFamily: EditorFontFamilyId;
  sourceFontSize: number;
  sourceFontFamily: EditorFontFamilyId;
  defaultViewMode: ViewModePref;
};

export const DEFAULT_PREFS: Prefs = {
  theme: "light",
  uiDensity: "comfortable",
  uiFontSize: 14,
  liveFontSize: 15,
  liveFontFamily: "sans",
  sourceFontSize: 14,
  sourceFontFamily: "mono",
  defaultViewMode: "live",
};

export type PrefKey = keyof Prefs;
