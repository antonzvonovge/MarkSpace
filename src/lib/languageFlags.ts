import type { NativeLanguageId } from "../settings/types";

/**
 * Representative country (ISO 3166-1 alpha-2) for each learning language.
 * Used for project tree / picker flag icons.
 */
const LANGUAGE_FLAG_COUNTRY: Record<NativeLanguageId, string> = {
  ru: "RU",
  en: "GB",
  de: "DE",
  fr: "FR",
  es: "ES",
  it: "IT",
  pt: "PT",
  zh: "CN",
  ja: "JP",
  ko: "KR",
  uk: "UA",
  pl: "PL",
  ka: "GE",
};

/** Regional-indicator flag emoji for a 2-letter country code, or "". */
export function countryFlagEmoji(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)),
  );
}

/** Flag emoji for a learning-language id, or "" when unknown / unset. */
export function learningLanguageFlagEmoji(language: string | null | undefined): string {
  const code = (language ?? "").trim();
  if (!code) return "";
  const country = LANGUAGE_FLAG_COUNTRY[code as NativeLanguageId];
  return country ? countryFlagEmoji(country) : "";
}
