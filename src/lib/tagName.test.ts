import { describe, expect, it } from "vitest";
import { sanitizeTagList, sanitizeTagName } from "./tagName";

describe("sanitizeTagName", () => {
  it("turns spaces into hyphens", () => {
    expect(sanitizeTagName("model context protocol")).toBe(
      "model-context-protocol",
    );
    expect(sanitizeTagName("  ai   agents ")).toBe("ai-agents");
  });

  it("strips a leading hash", () => {
    expect(sanitizeTagName("#work")).toBe("work");
  });

  it("keeps nesting and unicode", () => {
    expect(sanitizeTagName("project/markspace")).toBe("project/markspace");
    expect(sanitizeTagName("нейро сети")).toBe("нейро-сети");
  });

  it("drops unsupported characters and trims separators", () => {
    expect(sanitizeTagName("a.b,c")).toBe("a-b-c");
    expect(sanitizeTagName("--hi--")).toBe("hi");
    expect(sanitizeTagName("///")).toBe("");
  });
});

describe("sanitizeTagList", () => {
  it("sanitizes, drops empties and dedupes", () => {
    expect(sanitizeTagList(["AI agents", "ai-agents", "  ", "#work"])).toEqual([
      "AI-agents",
      "work",
    ]);
  });
});
