import { describe, expect, it } from "vitest";
import { rewriteWikiLinksInD2Source } from "./d2WikiLinks";

describe("rewriteWikiLinksInD2Source", () => {
  it("lifts [[path|alias]] in quoted labels onto D2 link", () => {
    const src = `improvement: "[[English/Lexicon/improvement|improvement]] (n)"`;
    expect(rewriteWikiLinksInD2Source(src)).toBe(
      `improvement: "improvement (n)" {\n  link: "wiki:${encodeURIComponent("English/Lexicon/improvement")}"\n}`,
    );
  });

  it("lifts editor wiki: markdown links", () => {
    const src = `improved: "[improved](wiki:English%2FLexicon%2Fimproved) (adj)"`;
    expect(rewriteWikiLinksInD2Source(src)).toBe(
      `improved: "improved (adj)" {\n  link: "wiki:${encodeURIComponent("English/Lexicon/improved")}"\n}`,
    );
  });

  it("leaves nodes without wiki-links alone", () => {
    const src = `improve: "improve (v)" {\n  shape: sequence_diagram\n}`;
    expect(rewriteWikiLinksInD2Source(src)).toBe(src);
  });
});
