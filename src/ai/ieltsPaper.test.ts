import { afterEach, describe, expect, it } from "vitest";
import {
  cancelAllPendingIeltsPaper,
  countWords,
  hasPendingIeltsPaper,
  normalizeIeltsPaper,
  parseIeltsPaperInput,
  resolveIeltsPaper,
  splitGapPrompt,
  waitForIeltsPaper,
} from "./ieltsPaper";

afterEach(() => {
  cancelAllPendingIeltsPaper();
});

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

describe("waitForIeltsPaper", () => {
  it("resolves from the UI", async () => {
    const pending = waitForIeltsPaper("call-1");
    expect(hasPendingIeltsPaper("call-1")).toBe(true);
    resolveIeltsPaper("call-1", {
      answers: [{ questionId: "q1", n: "1", value: "west gate" }],
    });
    await expect(pending).resolves.toMatchObject({
      answers: [{ value: "west gate" }],
    });
  });
});
