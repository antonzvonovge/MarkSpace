import { describe, expect, it } from "vitest";
import { resolveThreadReasoningMode } from "./types";
import { heuristicNeedsReasoning } from "./shouldUseReasoning";

describe("heuristicNeedsReasoning", () => {
  it("skips greetings and thanks", () => {
    expect(heuristicNeedsReasoning("привет")).toBe(false);
    expect(heuristicNeedsReasoning("thanks!")).toBe(false);
    expect(heuristicNeedsReasoning("ok")).toBe(false);
  });

  it("requires thinking for mechanism / why questions", () => {
    expect(
      heuristicNeedsReasoning("почему алкоголь влияет на кожу? какой механизм"),
    ).toBe(true);
    expect(heuristicNeedsReasoning("Explain the trade-off")).toBe(true);
  });

  it("defers to the worker when unsure", () => {
    expect(heuristicNeedsReasoning("открой заметку про кожу")).toBe(null);
    expect(heuristicNeedsReasoning("what time is the meeting")).toBe(null);
  });
});

describe("resolveThreadReasoningMode", () => {
  it("keeps older On/Off threads", () => {
    expect(
      resolveThreadReasoningMode({
        supports: true,
        enableReasoning: true,
      }),
    ).toBe("on");
    expect(
      resolveThreadReasoningMode({
        supports: true,
        enableReasoning: false,
      }),
    ).toBe("off");
  });

  it("prefers stored Auto", () => {
    expect(
      resolveThreadReasoningMode({
        supports: true,
        reasoningMode: "auto",
        enableReasoning: true,
      }),
    ).toBe("auto");
  });
});
