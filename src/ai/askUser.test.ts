import { afterEach, describe, expect, it } from "vitest";
import {
  cancelAllPendingAskUser,
  cancelAskUser,
  hasPendingAskUser,
  parseAskUserInput,
  resolveAskUserAnswer,
  waitForAskUserAnswer,
} from "./askUser";

afterEach(() => {
  cancelAllPendingAskUser();
});

describe("askUser pending registry", () => {
  it("resolves when the UI answers", async () => {
    const pending = waitForAskUserAnswer("call-1");
    expect(hasPendingAskUser("call-1")).toBe(true);
    const ok = resolveAskUserAnswer("call-1", {
      answers: [
        { questionId: "q1", selectedOptionIds: ["a"], customText: undefined },
      ],
    });
    expect(ok).toBe(true);
    await expect(pending).resolves.toEqual({
      answers: [
        { questionId: "q1", selectedOptionIds: ["a"], customText: undefined },
      ],
    });
    expect(hasPendingAskUser("call-1")).toBe(false);
  });

  it("rejects on abort signal", async () => {
    const controller = new AbortController();
    const pending = waitForAskUserAnswer("call-2", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(hasPendingAskUser("call-2")).toBe(false);
  });

  it("rejects when cancelled", async () => {
    const pending = waitForAskUserAnswer("call-3");
    cancelAskUser("call-3", "stopped");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("parseAskUserInput", () => {
  it("accepts a valid question round", () => {
    const input = parseAskUserInput({
      title: "Pick a style",
      questions: [
        {
          id: "style",
          prompt: "Which tone?",
          options: [
            { id: "formal", label: "Formal" },
            { id: "casual", label: "Casual" },
          ],
          allow_custom: true,
        },
      ],
    });
    expect(input?.questions).toHaveLength(1);
    expect(input?.title).toBe("Pick a style");
  });

  it("fills in missing ids", () => {
    const input = parseAskUserInput({
      title: "Tags",
      questions: [
        {
          prompt: "Suggested tags:",
          options: [
            { label: "architect" },
            { id: "llmops", label: "llmops" },
            { label: "architect" },
          ],
          allow_custom: true,
        },
      ],
    });
    expect(input?.questions[0]?.id).toBe("q1");
    expect(input?.questions[0]?.options.map((o) => o.id)).toEqual([
      "architect",
      "llmops",
      "architect-2",
    ]);
  });

  it("rejects fewer than two options", () => {
    expect(
      parseAskUserInput({
        questions: [
          {
            id: "q",
            prompt: "Only one?",
            options: [{ id: "a", label: "A" }],
          },
        ],
      }),
    ).toBeNull();
  });
});
