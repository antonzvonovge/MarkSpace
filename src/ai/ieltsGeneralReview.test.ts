import { describe, expect, it } from "vitest";
import {
  formatIeltsBand,
  formatIeltsGeneralReviewMarkdown,
  normalizeIeltsBand,
  parseIeltsGeneralReviewResponse,
  roundIeltsOverall,
  type IeltsGeneralReviewResult,
} from "./ieltsGeneralReview";

const sample: IeltsGeneralReviewResult = {
  text: "I am writing to ask about the course.",
  cc: 6.0,
  lr: 6.5,
  gra: 6.0,
  overall: 6.0,
  issues: [
    {
      criterion: "gra",
      quote: "I am writing to ask about the course.",
      problem: "Слишком общее начало для формального письма.",
      fix: "I am writing to enquire about the course.",
    },
  ],
  recommendations: [
    "Для formal letter сразу укажите цель в первом предложении.",
    "Избегайте повторов связок and / so.",
  ],
  rewrite: "I am writing to enquire about the course you advertised last week.",
};

describe("normalizeIeltsBand", () => {
  it("clamps and snaps to 0.5 steps", () => {
    expect(normalizeIeltsBand(6)).toBe(6);
    expect(normalizeIeltsBand(6.2)).toBe(6);
    expect(normalizeIeltsBand(6.3)).toBe(6.5);
    expect(normalizeIeltsBand(9.4)).toBe(9);
    expect(normalizeIeltsBand(-1)).toBe(0);
    expect(normalizeIeltsBand("7.5")).toBe(7.5);
  });

  it("throws on non-numeric input", () => {
    expect(() => normalizeIeltsBand("band")).toThrow(/band/i);
  });
});

describe("roundIeltsOverall", () => {
  it("averages three criteria and rounds .25 / .75 up", () => {
    expect(roundIeltsOverall(6, 6, 6)).toBe(6);
    expect(roundIeltsOverall(6, 6.5, 6)).toBe(6);
    expect(roundIeltsOverall(6.5, 6.5, 6)).toBe(6.5);
    expect(roundIeltsOverall(6.5, 6.5, 6.5)).toBe(6.5);
    expect(roundIeltsOverall(7, 6.5, 6.5)).toBe(6.5);
    expect(roundIeltsOverall(7, 7, 6.5)).toBe(7);
  });

  it("maps 6.25 mean to 6.5 and 6.75 mean to 7.0", () => {
    // (6.5 + 6.5 + 5.5) / 3 = 6.166… → 6.0
    expect(roundIeltsOverall(6.5, 6.5, 5.5)).toBe(6);
    // (6.5 + 6.5 + 6) / 3 = 6.333… → 6.5
    expect(roundIeltsOverall(6.5, 6.5, 6)).toBe(6.5);
    // (7 + 7 + 6.5) / 3 = 6.833… → 7.0
    expect(roundIeltsOverall(7, 7, 6.5)).toBe(7);
    // (6 + 6 + 6.75) / 3 = 6.25 → 6.5; (7 + 7 + 6.25) / 3 = 6.75 → 7.0
    expect(roundIeltsOverall(6, 6, 6.75)).toBe(6.5);
    expect(roundIeltsOverall(7, 7, 6.25)).toBe(7);
  });
});

describe("parseIeltsGeneralReviewResponse", () => {
  it("parses JSON, snaps bands, and computes overall in code", () => {
    const raw = JSON.stringify({
      cc: 6.2,
      lr: 7,
      gra: 6.4,
      overall: 9,
      issues: [
        {
          criterion: "GRA",
          quote: "  I go  ",
          problem: "Неверное время.",
          fix: "I went",
        },
        { criterion: "xx", problem: "skip" },
        { criterion: "lexical resource", quote: "", problem: "Повтор слов." },
      ],
      recommendations: ["Совет 1", "Совет 1", "Совет 2"],
      rewrite: "I went to the shop.\n\n\nIt was closed.",
    });
    const parsed = parseIeltsGeneralReviewResponse(raw, "I go to the shop.");
    expect(parsed.cc).toBe(6);
    expect(parsed.lr).toBe(7);
    expect(parsed.gra).toBe(6.5);
    expect(parsed.overall).toBe(roundIeltsOverall(6, 7, 6.5));
    expect(parsed.overall).not.toBe(9);
    expect(parsed.issues).toEqual([
      {
        criterion: "gra",
        quote: "I go",
        problem: "Неверное время.",
        fix: "I went",
      },
      {
        criterion: "lr",
        quote: "",
        problem: "Повтор слов.",
        fix: "",
      },
    ]);
    expect(parsed.recommendations).toEqual(["Совет 1", "Совет 2"]);
    expect(parsed.rewrite).toBe("I went to the shop.\n\nIt was closed.");
  });

  it("accepts fenced JSON", () => {
    const raw =
      '```json\n{"cc":5,"lr":5,"gra":5,"rewrite":"Hello.","issues":[],"recommendations":[]}\n```';
    const parsed = parseIeltsGeneralReviewResponse(raw, "Hi.");
    expect(parsed.cc).toBe(5);
    expect(parsed.rewrite).toBe("Hello.");
  });

  it("throws when rewrite is missing", () => {
    expect(() =>
      parseIeltsGeneralReviewResponse(
        '{"cc":6,"lr":6,"gra":6,"rewrite":""}',
        "x",
      ),
    ).toThrow(/rewrite/i);
  });
});

describe("formatIeltsGeneralReviewMarkdown", () => {
  it("formats bands, issues, recommendations, and rewrite", () => {
    expect(formatIeltsBand(6)).toBe("6.0");
    expect(formatIeltsGeneralReviewMarkdown(sample)).toBe(
      [
        "### IELTS General writing review (indicative)",
        "",
        "**Overall 6.0** · CC 6.0 · LR 6.5 · GRA 6.0",
        "",
        "**Issues**",
        '- **GRA** — "I am writing to ask about the course.": Слишком общее начало для формального письма.',
        "  Fix: I am writing to enquire about the course.",
        "",
        "**Recommendations**",
        "- Для formal letter сразу укажите цель в первом предложении.",
        "- Избегайте повторов связок and / so.",
        "",
        "**Rewrite**",
        "I am writing to enquire about the course you advertised last week.",
      ].join("\n"),
    );
  });

  it("omits empty quote and optional sections", () => {
    expect(
      formatIeltsGeneralReviewMarkdown({
        ...sample,
        issues: [
          {
            criterion: "cc",
            quote: "",
            problem: "Слабая связность абзацев.",
            fix: "",
          },
        ],
        recommendations: [],
      }),
    ).toBe(
      [
        "### IELTS General writing review (indicative)",
        "",
        "**Overall 6.0** · CC 6.0 · LR 6.5 · GRA 6.0",
        "",
        "**Issues**",
        "- **CC** — Слабая связность абзацев.",
        "",
        "**Rewrite**",
        "I am writing to enquire about the course you advertised last week.",
      ].join("\n"),
    );
  });
});
