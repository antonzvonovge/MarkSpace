import { describe, expect, it } from "vitest";
import {
  learningLanguageCountryCode,
  learningLanguageFlagSvg,
} from "./languageFlags";

describe("languageFlags", () => {
  it("maps learning languages to country codes", () => {
    expect(learningLanguageCountryCode("en")).toBe("GB");
    expect(learningLanguageCountryCode("ru")).toBe("RU");
    expect(learningLanguageCountryCode("ka")).toBe("GE");
    expect(learningLanguageCountryCode("")).toBe("");
    expect(learningLanguageCountryCode(null)).toBe("");
  });

  it("resolves SVG flag components for known languages", () => {
    expect(learningLanguageFlagSvg("de")).toBeTypeOf("function");
    expect(learningLanguageFlagSvg("unknown")).toBeNull();
    expect(learningLanguageFlagSvg("")).toBeNull();
  });
});
