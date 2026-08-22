import { describe, expect, it } from "vitest";
import {
  emptyQuickTranslateCache,
  lookupCachedTranslation,
  normalizeTranslateSurface,
  recordIdForResult,
  remapCachedNotePath,
  surfacesFromResult,
  translateAliasKey,
  upsertCachedTranslation,
} from "./quickTranslateCache";
import type { QuickTranslateResult } from "../ai/quickTranslate";

const apple: QuickTranslateResult = {
  query: "Apples",
  queryLang: "en",
  lemma: "apple",
  transcript: "",
  translation: "яблоко",
  translationTranscript: "",
  didYouMean: "",
  forms: ["apples"],
  synonyms: [],
  senses: [],
  examples: [],
};

describe("quickTranslateCache", () => {
  it("normalizes unicode and case", () => {
    expect(normalizeTranslateSurface("  Äpfel  ")).toBe("äpfel");
    expect(normalizeTranslateSurface("e\u0301")).toBe("é");
  });

  it("looks up aliases after upsert", () => {
    const file = upsertCachedTranslation(
      emptyQuickTranslateCache(),
      "en",
      "ru",
      apple,
      "En/Lexicon/apple.md",
    );
    expect(lookupCachedTranslation(file, "en", "ru", "apples")?.result.lemma).toBe(
      "apple",
    );
    expect(lookupCachedTranslation(file, "en", "ru", "яблоко")?.notePath).toBe(
      "En/Lexicon/apple.md",
    );
    expect(lookupCachedTranslation(file, "ka", "ru", "apple")).toBeNull();
  });

  it("remaps note paths", () => {
    let file = upsertCachedTranslation(
      emptyQuickTranslateCache(),
      "en",
      "ru",
      apple,
      "En/Lexicon/apple.md",
    );
    file = remapCachedNotePath(
      file,
      "En/Lexicon/apple.md",
      "En/Lexicon/nouns/apple.md",
    );
    const id = recordIdForResult("en", "ru", apple);
    expect(file.records[id]?.notePath).toBe("En/Lexicon/nouns/apple.md");
  });

  it("collects unique surfaces", () => {
    expect(surfacesFromResult(apple)).toEqual(["Apples", "apple", "яблоко"]);
    expect(translateAliasKey("EN", "RU", "Apple")).toBe(
      translateAliasKey("en", "ru", "apple"),
    );
  });
});
