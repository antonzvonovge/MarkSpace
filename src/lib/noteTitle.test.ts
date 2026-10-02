import { describe, expect, it } from "vitest";
import {
  canEditNoteTitle,
  displayNoteTitle,
  firstAtxHeading,
  noteTitleIndexKey,
  replaceFirstHeading,
  stripInlineMarkdown,
  treeRowTitleLabel,
} from "./noteTitle";

describe("noteTitleIndexKey", () => {
  it("maps a folder note to its parent folder", () => {
    expect(noteTitleIndexKey("Projects/ideas/.folder.md")).toBe("Projects/ideas");
    expect(noteTitleIndexKey("Notes/todo.md")).toBe("Notes/todo.md");
    expect(noteTitleIndexKey(".folder.md")).toBe(".folder.md");
  });
});

describe("first heading", () => {
  it("skips frontmatter and uses the first ATX heading", () => {
    const md = "---\ntitle: yaml\n---\n\n# Real title\n\n## Later\n";
    expect(firstAtxHeading(md)).toBe("Real title");
    expect(displayNoteTitle(md)).toBe("Real title");
  });

  it("ignores a heading inside a fence", () => {
    const md = "```\n# inside\n```\n\n## Outside\n";
    expect(firstAtxHeading(md)).toBe("Outside");
  });

  it("returns null when there is no heading", () => {
    expect(displayNoteTitle("just a paragraph\n")).toBeNull();
  });
});

describe("stripInlineMarkdown", () => {
  it("unwraps emphasis, code, and wiki aliases", () => {
    expect(stripInlineMarkdown("**Title**")).toBe("Title");
    expect(stripInlineMarkdown("hello_world")).toBe("hello_world");
    expect(stripInlineMarkdown("[[Note|Alias]]")).toBe("Alias");
    expect(stripInlineMarkdown("`code`")).toBe("code");
  });
});

describe("replaceFirstHeading", () => {
  it("keeps the heading level", () => {
    expect(replaceFirstHeading("## Old\n\nbody\n", "New")).toBe("## New\n\nbody\n");
  });

  it("inserts a heading when missing", () => {
    expect(replaceFirstHeading("body\n", "Title")).toBe("# Title\n\nbody\n");
  });

  it("inserts after frontmatter", () => {
    expect(replaceFirstHeading("---\na: 1\n---\n\nbody\n", "Title")).toBe(
      "---\na: 1\n---\n# Title\n\nbody\n",
    );
  });

  it("does not rewrite a fenced heading", () => {
    const md = "```\n# inside\n```\n\n## Outside\n";
    expect(replaceFirstHeading(md, "Next")).toBe("```\n# inside\n```\n\n## Next\n");
  });

  it("creates a heading in an empty note", () => {
    expect(replaceFirstHeading("", "Hello")).toBe("# Hello\n");
  });
});

describe("treeRowTitleLabel", () => {
  it("keeps the file name when the setting is off", () => {
    expect(
      treeRowTitleLabel("Notes/a.md", false, "a.md", false, {
        "Notes/a.md": "Hello",
      }),
    ).toEqual({ label: "a.md", literal: false, selectAll: false });
  });

  it("shows the heading and selects the whole rename field", () => {
    expect(
      treeRowTitleLabel("Notes/a.md", false, "a.md", true, {
        "Notes/a.md": "Hello",
      }),
    ).toEqual({
      label: "Hello",
      literal: true,
      selectAll: true,
      tooltip: "Notes/a.md",
    });
  });

  it("falls back to the file name but still edits the heading", () => {
    expect(treeRowTitleLabel("Notes/a.md", false, "a.md", true, {})).toEqual({
      label: "a.md",
      literal: false,
      selectAll: true,
    });
    expect(canEditNoteTitle("Notes/pic.pdf", false)).toBe(false);
    expect(canEditNoteTitle("Notes", true)).toBe(true);
  });
});
