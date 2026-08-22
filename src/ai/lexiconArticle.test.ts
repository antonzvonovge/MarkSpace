import { describe, expect, it } from "vitest";
import { sanitizeLexiconArticleMarkdown } from "./lexiconArticle";

describe("sanitizeLexiconArticleMarkdown", () => {
  it("strips fences, frontmatter, and Notes", () => {
    const raw = `\`\`\`md
---
lemma: go
---
# go

## Meanings

* to move

## Notes

secret
\`\`\``;
    const out = sanitizeLexiconArticleMarkdown(raw, "go");
    expect(out.startsWith("# go")).toBe(true);
    expect(out).toContain("Meanings");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("lemma: go");
  });

  it("adds H1 when missing", () => {
    expect(sanitizeLexiconArticleMarkdown("## Grammar\n\n* go / went", "go")).toMatch(
      /^# go\n/,
    );
  });

  it("collapses extra blank lines", () => {
    const out = sanitizeLexiconArticleMarkdown("# go\n\n\n\n## Meanings\n", "go");
    expect(out).not.toMatch(/\n{3,}/);
  });
});
