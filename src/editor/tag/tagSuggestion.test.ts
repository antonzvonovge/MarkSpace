import { describe, expect, it } from "vitest";
import { rankTagSuggestions } from "./tagSuggestion";

describe("rankTagSuggestions", () => {
  const tags = [
    "agent",
    "multi-agent",
    "inbox",
    "project/markspace",
    "work",
    "workflow",
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "zeta",
  ];

  it("returns at most 10 tags when query is empty", () => {
    expect(rankTagSuggestions(tags, "").length).toBe(10);
  });

  it("prefers prefix matches over substring matches", () => {
    expect(rankTagSuggestions(tags, "work")).toEqual(["work", "workflow"]);
  });

  it("ranks multi-agent under multi", () => {
    expect(rankTagSuggestions(tags, "multi")).toEqual(["multi-agent"]);
  });

  it("caps results at 10", () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag-${i}`);
    expect(rankTagSuggestions(many, "tag").length).toBe(10);
  });
});
