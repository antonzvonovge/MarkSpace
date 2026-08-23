import { describe, expect, it } from "vitest";
import {
  countWords,
  formatIeltsPaperAsMarkdown,
  normalizeIeltsPaper,
  parseIeltsPaperInput,
  splitGapPrompt,
} from "./ieltsPaper";
import { defaultIeltsTimerSeconds, formatIeltsGradeMarkdown } from "./ieltsGenerate";

describe("normalizeIeltsPaper", () => {
  it("fills ids and shared matching bank", () => {
    const paper = normalizeIeltsPaper({
      title: "Section 2",
      intro: "WRITE NO MORE THAN TWO WORDS",
      options: [
        { label: "main workshop" },
        { label: "café" },
      ],
      questions: [
        {
          n: "11",
          kind: "gap",
          prompt: "Date of the event: Saturday ____",
          heading: "Event information",
        },
        {
          n: "16",
          kind: "choice",
          prompt: "Bicycle safety check",
          heading: "Questions 16–20",
        },
      ],
    });
    expect(paper.questions[0]!.id).toBe("q11");
    expect(paper.questions[1]!.options.map((o) => o.id)).toEqual(["A", "B"]);
    expect(paper.questions[1]!.options[0]!.label).toBe("main workshop");
  });
});

describe("formatIeltsPaperAsMarkdown", () => {
  it("keeps passage, bank, headings and items", () => {
    const paper = normalizeIeltsPaper({
      title: "Section 2",
      intro: "WRITE NO MORE THAN TWO WORDS",
      options: [{ label: "main workshop" }, { label: "café" }],
      questions: [
        {
          n: "11",
          kind: "gap",
          prompt: "Date of the event: Saturday ____",
          heading: "Event information",
        },
        {
          n: "16",
          kind: "choice",
          prompt: "Bicycle safety check",
          heading: "Questions 16–20",
        },
      ],
    });
    const md = formatIeltsPaperAsMarkdown(paper);
    expect(md).toContain("### Section 2");
    expect(md).toContain("WRITE NO MORE THAN TWO WORDS");
    expect(md).toContain("**A** main workshop");
    expect(md).toContain("#### Event information");
    expect(md).toContain("11. Date of the event: Saturday ____");
    expect(md).toContain("* **A** main workshop");
    expect(md).toContain("16. Bicycle safety check");
    expect(md).not.toContain("(A / B)");
  });

  it("lists full A/B/C wording under multiple-choice items", () => {
    const md = formatIeltsPaperAsMarkdown(
      normalizeIeltsPaper({
        title: "Section 1",
        intro: "Choose A, B or C.",
        questions: [
          {
            n: "7",
            kind: "choice",
            prompt: "Where do they meet?",
            options: [
              { label: "inside the café at Central Station" },
              { label: "at the tour office" },
              { label: "in the riverside car park" },
            ],
          },
        ],
      }),
    );
    expect(md).toContain("7. Where do they meet?");
    expect(md).toContain("* **A** inside the café at Central Station");
    expect(md).toContain("* **C** in the riverside car park");
  });
});

describe("splitGapPrompt", () => {
  it("splits on underscores", () => {
    expect(splitGapPrompt("Saturday ____")).toEqual(["Saturday ", ""]);
  });
});

describe("countWords", () => {
  it("counts tokens", () => {
    expect(countWords("  hello there  ")).toBe(2);
    expect(countWords("")).toBe(0);
  });
});

describe("parseIeltsPaperInput", () => {
  it("ignores other actions", () => {
    expect(parseIeltsPaperInput({ action: "start" })).toBeNull();
  });
  it("parses show_paper", () => {
    const paper = parseIeltsPaperInput({
      action: "show_paper",
      questions: [{ prompt: "Hello ____", kind: "gap", n: "1" }],
    });
    expect(paper?.questions).toHaveLength(1);
  });
});

describe("defaultIeltsTimerSeconds", () => {
  it("uses GT timings", () => {
    expect(defaultIeltsTimerSeconds("reading", "section-1")).toBe(20 * 60);
    expect(defaultIeltsTimerSeconds("reading", "mini")).toBe(10 * 60);
    expect(defaultIeltsTimerSeconds("writing", "t2-opinion")).toBe(40 * 60);
    expect(defaultIeltsTimerSeconds("listening", "section-1")).toBe(0);
  });
});

describe("formatIeltsGradeMarkdown", () => {
  it("includes indicative score and key", () => {
    const md = formatIeltsGradeMarkdown({
      skill: "reading",
      paper: {
        title: "Notices",
        intro: "Read the notices.",
        options: [],
        questions: [
          {
            id: "q1",
            n: "1",
            kind: "gap",
            prompt: "Date of the event: Saturday ____",
            placeholder: "Answer",
            heading: "",
            options: [],
          },
        ],
      },
      grade: {
        correct: 8,
        total: 10,
        recap: "Good work.",
        items: [{ n: "1", yours: "west", correct: "west", trap: "" }],
      },
      answerKey: "1. west",
    });
    expect(md).toContain("**Indicative score:** 8/10");
    expect(md).toContain("1. west");
    expect(md).toContain("## Paper");
    expect(md).toContain("Read the notices.");
    expect(md).toContain("1. Date of the event: Saturday ____");
  });

  it("formats script turns as markdown paragraphs", () => {
    const md = formatIeltsGradeMarkdown({
      skill: "listening",
      paper: {
        title: "Tour",
        intro: "Listen.",
        options: [],
        questions: [],
      },
      grade: { correct: 1, total: 1, recap: "Ok.", items: [] },
      answerKey: "1. A",
      script: "Employee: Hello.\nCustomer: Hi.",
    });
    expect(md).toContain("## Script");
    expect(md).toContain("**Employee:** Hello.");
    expect(md).toContain("**Customer:** Hi.");
  });
});
