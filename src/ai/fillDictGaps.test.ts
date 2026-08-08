import { describe, expect, it } from "vitest";
import {
  applyGapFill,
  entryNeedsGapFill,
  missingDictFields,
} from "./fillDictGaps";

describe("missingDictFields / entryNeedsGapFill", () => {
  it("requires a word before considering gaps", () => {
    expect(
      entryNeedsGapFill({
        word: "",
        transcript: "",
        translation: "house",
        examples: [],
      }),
    ).toBe(false);
  });

  it("detects empty transcript, translation, and examples", () => {
    expect(
      missingDictFields({
        word: "haus",
        transcript: "",
        translation: "  ",
        examples: ["", "  "],
      }),
    ).toEqual({
      transcript: true,
      translation: true,
      examples: true,
    });
    expect(
      entryNeedsGapFill({
        word: "haus",
        transcript: "",
        translation: "",
        examples: [],
      }),
    ).toBe(true);
  });

  it("skips complete entries", () => {
    expect(
      entryNeedsGapFill({
        word: "haus",
        transcript: "/haʊs/",
        translation: "house",
        examples: ["Das Haus ist groß."],
      }),
    ).toBe(false);
  });
});

describe("applyGapFill", () => {
  it("only overwrites empty fields", () => {
    const entry = {
      word: "haus",
      transcript: "/haʊs/",
      translation: "",
      examples: [],
    };
    expect(
      applyGapFill(entry, {
        transcript: "wrong",
        translation: "house",
        examples: ["Das Haus ist groß."],
      }),
    ).toEqual({
      word: "haus",
      transcript: "/haʊs/",
      translation: "house",
      examples: ["Das Haus ist groß."],
    });
  });
});
