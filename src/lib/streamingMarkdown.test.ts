import { describe, expect, it } from "vitest";
import { splitStreamingMarkdown } from "./streamingMarkdown";

describe("splitStreamingMarkdown", () => {
  it("keeps a partial first paragraph in the tail", () => {
    expect(splitStreamingMarkdown("Hello **wor")).toEqual({
      stable: "",
      tail: "Hello **wor",
    });
  });

  it("promotes completed paragraphs into stable", () => {
    expect(splitStreamingMarkdown("First paragraph.\n\nSecond **par")).toEqual({
      stable: "First paragraph.",
      tail: "Second **par",
    });
  });

  it("promotes a finished line within the last block", () => {
    expect(splitStreamingMarkdown("Line one\nLine two being")).toEqual({
      stable: "Line one",
      tail: "Line two being",
    });
  });

  it("treats a trailing newline as completing the last line", () => {
    expect(splitStreamingMarkdown("Done line\n")).toEqual({
      stable: "Done line",
      tail: "",
    });
  });

  it("keeps an unclosed fence entirely in the tail", () => {
    const text = "Intro\n\n```ts\nconst x = 1";
    expect(splitStreamingMarkdown(text)).toEqual({
      stable: "Intro",
      tail: "```ts\nconst x = 1",
    });
  });

  it("promotes a closed fence into stable", () => {
    const text = "Intro\n\n```ts\nconst x = 1\n```\n\nAfter";
    expect(splitStreamingMarkdown(text)).toEqual({
      stable: "Intro\n\n```ts\nconst x = 1\n```",
      tail: "After",
    });
  });

  it("returns empty parts for empty input", () => {
    expect(splitStreamingMarkdown("")).toEqual({ stable: "", tail: "" });
  });
});
