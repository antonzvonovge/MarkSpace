import type { ComponentType } from "react";
import {
  CN,
  DE,
  ES,
  FR,
  GB,
  GE,
  IT,
  JP,
  KR,
  PL,
  PT,
  RU,
  UA,
} from "country-flag-icons/react/1x1";
import type { NativeLanguageId } from "../settings/types";

type FlagSvg = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

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

/** SVG flag components — used instead of emoji (Windows has no flag glyphs). */
const COUNTRY_FLAG_SVG: Record<string, FlagSvg> = {
  RU,
  GB,
  DE,
  FR,
  ES,
  IT,
  PT,
  CN,
  JP,
  KR,
  UA,
  PL,
  GE,
};

/** ISO country code for a learning-language id, or "" when unknown / unset. */
export function learningLanguageCountryCode(
  language: string | null | undefined,
): string {
  const code = (language ?? "").trim();
  if (!code) return "";
  return LANGUAGE_FLAG_COUNTRY[code as NativeLanguageId] ?? "";
}

/** SVG flag component for a learning-language id, or null when unknown / unset. */
export function learningLanguageFlagSvg(
  language: string | null | undefined,
): FlagSvg | null {
  const country = learningLanguageCountryCode(language);
  return country ? (COUNTRY_FLAG_SVG[country] ?? null) : null;
}
