import { describe, expect, it } from "vitest";
import { _test } from "./translateNote";

const {
  translatedSiblingPath,
  stripOuterFence,
  noteStem,
  protectInlineTags,
  joinWithOriginalFrontmatter,
} = _test;

describe("translateNote helpers", () => {
  it("builds sibling path with uppercase language code", () => {
    expect(translatedSiblingPath("Meeting.md", "ru")).toBe("Meeting.RU.md");
    expect(translatedSiblingPath("Project/Notes/Meeting.md", "en")).toBe(
      "Project/Notes/Meeting.EN.md",
    );
  });

  it("strips note stem extension", () => {
    expect(noteStem("Folder/Hello.md")).toBe("Hello");
    expect(noteStem("Hello.MD")).toBe("Hello");
  });

  it("strips outer markdown fences from model output", () => {
    expect(stripOuterFence("```markdown\n# Hi\n\nText\n```")).toBe("# Hi\n\nText");
    expect(stripOuterFence("# Already clean")).toBe("# Already clean");
  });

  it("masks and restores inline tags without translating them", () => {
    const body = "See #project/markspace and #work today.";
    const { text, restore } = protectInlineTags(body);
    expect(text).not.toContain("#project/markspace");
    expect(text).not.toContain("#work");
    expect(text).toMatch(/⟦MS_TAG_\d+⟧/);
    expect(restore(text)).toBe(body);
    expect(
      restore("См. ⟦MS_TAG_0⟧ и ⟦MS_TAG_1⟧ сегодня."),
    ).toBe("См. #project/markspace и #work сегодня.");
  });

  it("reattaches original frontmatter verbatim and drops model fences", () => {
    const original = `---
created: 2026-08-01T10:00:00.000Z
tags:
  - work
  - project/markspace
---
Hello
`;
    const joined = joinWithOriginalFrontmatter(
      original,
      `---
tags:
  - работа
---
Привет
`,
    );
    expect(joined).toBe(`---
created: 2026-08-01T10:00:00.000Z
tags:
  - work
  - project/markspace
---
Привет
`);
  });
});
