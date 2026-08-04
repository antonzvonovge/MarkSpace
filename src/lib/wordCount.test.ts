import { describe, expect, it } from "vitest";
import { countWords } from "./wordCount";

describe("countWords", () => {
  it("returns 0 for empty/whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t")).toBe(0);
  });

  it("counts space-separated words", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  hello   world  ")).toBe(2);
  });
});
