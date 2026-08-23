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

/** Profile gender. Empty string = not set. */
export type UserGenderId = "" | "male" | "female";

export const USER_GENDER_OPTIONS: {
  value: UserGenderId;
  label: string;
}[] = [
  { value: "", label: "Not set" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

export function isUserGenderId(value: unknown): value is UserGenderId {
  return value === "" || value === "male" || value === "female";
}

export function userGenderLabel(gender: UserGenderId): string {
  return USER_GENDER_OPTIONS.find((o) => o.value === gender)?.label ?? gender;
}

export type Prefs = {
  userName: string;
  /** ISO date `YYYY-MM-DD`, or empty if not set. */
  userBirthday: string;
  userGender: UserGenderId;
  nativeLanguage: NativeLanguageId;
  theme: ThemeId;
  uiDensity: UiDensityId;
  uiFontSize: number;
  liveFontSize: number;
  /** Live editor font size for notes inside diary projects. */
  liveFontSizeDiary: number;
  liveFontFamily: EditorFontFamilyId;
  sourceFontSize: number;
  sourceFontFamily: EditorFontFamilyId;
  defaultViewMode: ViewModePref;
};

export const DEFAULT_PREFS: Prefs = {
  userName: "",
  userBirthday: "",
  userGender: "",
  nativeLanguage: "ru",
  theme: "light",
  uiDensity: "comfortable",
  uiFontSize: 14,
  liveFontSize: 15,
  liveFontSizeDiary: 15,
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
