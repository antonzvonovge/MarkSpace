import { describe, expect, it } from "vitest";
import {
  collectLearningLanguageCodes,
  dictHeadwordLang,
  dictItemFromQuickTranslate,
  formatQuickTranslateMarkdown,
  parseQuickTranslateResponse,
  quickTranslatePairCodes,
  quickTranslatePairLabel,
  quickTranslateShowForms,
  quickTranslateTargetHead,
  type QuickTranslateResult,
} from "./quickTranslate";

/** English query → Russian card (inverse). */
const enQuery: QuickTranslateResult = {
  query: "apple",
  queryLang: "en",
  lemma: "apple",
  transcript: "/ˈæp.əl/",
  translation: "яблоко",
  translationTranscript: "ˈjabləkə",
  forms: ["яблоки (мн.)"],
  synonyms: [],
  didYouMean: "",
  senses: [],
  examples: [
    {
      text: "Я съел яблоко.",
      translation: "I ate an apple.",
      note: "",
    },
  ],
};

/** Russian query → English card (inverse). */
const ruQuery: QuickTranslateResult = {
  query: "крыса",
  queryLang: "ru",
  lemma: "крыса",
  transcript: "ˈkrɨsə",
  translation: "rat",
  translationTranscript: "/ræt/",
  forms: ["rats (pl)"],
  synonyms: ["mouse"],
  didYouMean: "",
  senses: [],
  examples: [
    {
      text: "The rat escaped from the cage.",
      translation: "Крыса убежала из клетки.",
      note: "",
    },
  ],
};

describe("parseQuickTranslateResponse", () => {
  it("parses JSON and normalizes fields", () => {
    const raw = JSON.stringify({
      queryLang: "ru",
      lemma: "яблоко",
      transcript: "ˈjabləkə",
      translation: "apple",
      translationTranscript: "/ˈæp.əl/",
      forms: ["apples (pl)"],
      synonyms: ["fruit", "apple", "pome", "яблоко", "fruit"],
      examples: [
        { text: "Eat an apple.", translation: "Ешь яблоко." },
        { text: "Eat an apple.", translation: "duplicate" },
      ],
    });
    expect(parseQuickTranslateResponse(raw, "яблоко")).toEqual({
      query: "яблоко",
      queryLang: "ru",
      lemma: "яблоко",
      transcript: "ˈjabləkə",
      translation: "apple",
      translationTranscript: "/ˈæp.əl/",
      forms: ["apples (pl)"],
      synonyms: ["fruit", "pome"],
      didYouMean: "",
      senses: [],
      examples: [{ text: "Eat an apple.", translation: "Ешь яблоко.", note: "" }],
    });
  });

  it("accepts fenced JSON and falls back to en", () => {
    const raw = '```json\n{"lemma":"cat","translation":"кот","forms":[]}\n```';
    const parsed = parseQuickTranslateResponse(raw, "cat");
    expect(parsed.queryLang).toBe("en");
    expect(parsed.lemma).toBe("cat");
    expect(parsed.translation).toBe("кот");
    expect(parsed.synonyms).toEqual([]);
    expect(parsed.didYouMean).toBe("");
    expect(parsed.senses).toEqual([]);
  });

  it("parses senses, collocations, and a spelling hint", () => {
    const parsed = parseQuickTranslateResponse(
      JSON.stringify({
        queryLang: "en",
        lemma: "accommodation",
        translation: "жильё",
        didYouMean: "accommodation",
        senses: [
          {
            pos: "noun",
            meaning: "жильё, размещение",
            register: "Formal",
            usage: "Письмо арендодателю или жалобы на жильё.",
            collocations: ["book accommodation", "suitable accommodation"],
          },
        ],
        examples: [
          {
            text: "The hotel did not provide the accommodation I booked.",
            translation: "Отель не предоставил жильё, которое я забронировал.",
            note: "Task 1: complaint letter",
          },
        ],
      }),
      "accomodation",
    );
    expect(parsed.didYouMean).toBe("accommodation");
    expect(parsed.senses[0]?.pos).toBe("noun");
    expect(parsed.senses[0]?.collocations).toEqual([
      "book accommodation",
      "suitable accommodation",
    ]);
    expect(parsed.examples[0]?.note).toBe("Task 1: complaint letter");
  });

  it("clears didYouMean when it repeats the query", () => {
    const parsed = parseQuickTranslateResponse(
      JSON.stringify({
        lemma: "apple",
        translation: "яблоко",
        didYouMean: "apple",
      }),
      "apple",
    );
    expect(parsed.didYouMean).toBe("");
  });

  it("throws when translation is missing", () => {
    expect(() =>
      parseQuickTranslateResponse('{"lemma":"x","translation":""}', "x"),
    ).toThrow(/translation/i);
  });
});

describe("formatQuickTranslateMarkdown", () => {
  it("leads with Russian when the query is English and does not repeat the query", () => {
    expect(quickTranslateTargetHead(enQuery)).toEqual({
      word: "яблоко",
      transcript: "ˈjabləkə",
      gloss: "apple",
    });
    expect(formatQuickTranslateMarkdown(enQuery)).toBe(
      [
        "яблоко ˈjabləkə",
        "Forms: яблоки (мн.)",
        "- Я съел яблоко. — I ate an apple.",
      ].join("\n"),
    );
  });

  it("omits forms and transcript when translating into the native language", () => {
    expect(quickTranslateShowForms(enQuery, "ru")).toBe(false);
    expect(formatQuickTranslateMarkdown(enQuery, "ru")).toBe(
      ["яблоко", "- Я съел яблоко. — I ate an apple."].join("\n"),
    );
  });

  it("omits empty transcript and forms", () => {
    expect(
      formatQuickTranslateMarkdown({
        ...enQuery,
        translationTranscript: "",
        forms: [],
        examples: [{ text: "Привет.", translation: "", note: "" }],
      }),
    ).toBe("яблоко\n- Привет.");
  });

  it("keeps English forms when the query is in the native language", () => {
    expect(quickTranslateShowForms(ruQuery, "ru")).toBe(true);
    expect(formatQuickTranslateMarkdown(ruQuery, "ru")).toBe(
      [
        "rat /ræt/",
        "Forms: rats (pl)",
        "- The rat escaped from the cage. — Крыса убежала из клетки.",
      ].join("\n"),
    );
  });
});

describe("dictItemFromQuickTranslate", () => {
  it("stores English as the headword when native language is Russian", () => {
    expect(dictHeadwordLang("ru")).toBe("en");
    expect(dictItemFromQuickTranslate(enQuery, "ru")).toEqual({
      word: "apple",
      transcript: "/ˈæp.əl/",
      translation: "яблоко",
      examples: ["I ate an apple."],
      tags: [],
      known: false,
    });
  });

  it("uses the English translation as the headword for a Russian query", () => {
    expect(dictItemFromQuickTranslate(ruQuery, "ru")).toEqual({
      word: "rat",
      transcript: "/ræt/",
      translation: "крыса",
      examples: ["The rat escaped from the cage."],
      tags: [],
      known: false,
    });
  });

  it("stores Russian as the headword when native language is English", () => {
    expect(dictHeadwordLang("en")).toBe("ru");
    expect(dictItemFromQuickTranslate(enQuery, "en").word).toBe("яблоко");
    expect(dictItemFromQuickTranslate(enQuery, "en").translation).toBe("apple");
  });
});

describe("quickTranslate pairs", () => {
  it("collects unique learning languages from projects", () => {
    expect(
      collectLearningLanguageCodes(
        {
          Geo: {
            projectType: "languageLearning",
            learningLanguage: "ka",
          },
          German: {
            projectType: "languageLearning",
            learningLanguage: "de",
          },
          Notes: { projectType: "knowledgeBase", learningLanguage: "" },
          Dup: {
            projectType: "languageLearning",
            learningLanguage: "ka",
          },
        },
        "ru",
      ),
    ).toEqual(["ka", "de"]);
  });

  it("puts English first in the pair list and skips native", () => {
    expect(quickTranslatePairCodes(["ka", "en"], "ru")).toEqual(["en", "ka"]);
    expect(quickTranslatePairCodes(["ka"], "en")).toEqual(["ka"]);
    expect(quickTranslatePairLabel("ka", "ru")).toBe("Georgian ↔ Russian");
  });

  it("accepts a Georgian queryLang for a Georgian pair", () => {
    const parsed = parseQuickTranslateResponse(
      JSON.stringify({
        queryLang: "ka",
        lemma: "გამარჯობა",
        translation: "привет",
        forms: [],
        examples: [{ text: "Привет.", translation: "გამარჯობა." }],
      }),
      "გამარჯობა",
      { foreign: "ka", native: "ru" },
    );
    expect(parsed.queryLang).toBe("ka");
  });
});
