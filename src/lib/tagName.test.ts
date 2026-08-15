import { describe, expect, it } from "vitest";
import {
  compactTagKey,
  resolveSuggestedTags,
  sanitizeTagList,
  sanitizeTagName,
} from "./tagName";

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

describe("resolveSuggestedTags", () => {
  it("prefers catalog spelling over invented variants", () => {
    expect(
      resolveSuggestedTags(
        ["AI Agents", "multiagent", "#Work", "project/MarkSpace"],
        ["ai-agents", "multi-agent", "work", "project/markspace"],
      ),
    ).toEqual(["ai-agents", "multi-agent", "work", "project/markspace"]);
  });

  it("lowercases new kebab-case tags and drops digits-only", () => {
    expect(
      resolveSuggestedTags(["My Topic", "42", "нейро Сети"], []),
    ).toEqual(["my-topic", "нейро-сети"]);
  });

  it("dedupes and respects max", () => {
    expect(
      resolveSuggestedTags(["a", "A", "b", "c"], [], 2),
    ).toEqual(["a", "b"]);
    expect(
      resolveSuggestedTags(["a", "b", "c", "d", "e"], []),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores non-string items", () => {
    expect(compactTagKey("ai_agents")).toBe("aiagents");
    expect(resolveSuggestedTags([1, null, { x: 1 }, "ok"], [])).toEqual(["ok"]);
  });
});
