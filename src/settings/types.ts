export type ThemeId = "light" | "dark";
export type UiDensityId = "comfortable" | "compact";
export type EditorFontFamilyId = "sans" | "mono";
export type ViewModePref = "live" | "source";

/** ISO 639-1 codes used for native language + translated note suffixes. */
export type NativeLanguageId =
  | "ru"
  | "en"
  | "de"
  | "fr"
  | "es"
  | "it"
  | "pt"
  | "zh"
  | "ja"
  | "ko"
  | "uk"
  | "pl"
  | "ka";

export type Prefs = {
  userName: string;
  nativeLanguage: NativeLanguageId;
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
  userName: "",
  nativeLanguage: "ru",
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

export const NATIVE_LANGUAGE_OPTIONS: {
  value: NativeLanguageId;
  label: string;
}[] = [
  { value: "ru", label: "Russian" },
  { value: "en", label: "English" },
  { value: "uk", label: "Ukrainian" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "pl", label: "Polish" },
  { value: "ka", label: "Georgian" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
];

export function isNativeLanguageId(value: unknown): value is NativeLanguageId {
  return (
    typeof value === "string" &&
    NATIVE_LANGUAGE_OPTIONS.some((o) => o.value === value)
  );
}

/** Uppercase letter code for filenames, e.g. `ru` → `RU`. */
export function nativeLanguageFileCode(lang: NativeLanguageId): string {
  return lang.toUpperCase();
}

export function nativeLanguageLabel(lang: NativeLanguageId): string {
  return (
    NATIVE_LANGUAGE_OPTIONS.find((o) => o.value === lang)?.label ?? lang
  );
}
