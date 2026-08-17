import { describe, expect, it } from "vitest";
import {
  resolveSaveChatNotePath,
  suggestedNoteNameFromMarkdown,
} from "./saveChatMessage";

describe("suggestedNoteNameFromMarkdown", () => {
  it("prefers the first ATX heading", () => {
    expect(
      suggestedNoteNameFromMarkdown("Intro\n\n# Hello World\n\nbody"),
    ).toBe("Hello World");
  });

  it("strips inline markdown from headings", () => {
    expect(suggestedNoteNameFromMarkdown("# **Bold** and `code`")).toBe(
      "Bold and code",
    );
    expect(suggestedNoteNameFromMarkdown("# See [[Note|alias]]")).toBe(
      "See Note",
    );
  });

  it("falls back to the first non-empty line", () => {
    expect(suggestedNoteNameFromMarkdown("  \nA short reply.\nMore")).toBe(
      "A short reply.",
    );
  });

  it("falls back to Untitled when empty", () => {
    expect(suggestedNoteNameFromMarkdown("   \n")).toBe("Untitled");
  });

  it("strips characters that are illegal in filenames", () => {
    expect(suggestedNoteNameFromMarkdown("# Hello: world?")).toBe(
      "Hello world",
    );
  });
});

describe("resolveSaveChatNotePath", () => {
  it("places a bare name in the chat project", () => {
    expect(resolveSaveChatNotePath("Lesson 5", "German")).toBe(
      "German/Lesson 5.md",
    );
  });

  it("places a bare name at the vault root without a project", () => {
    expect(resolveSaveChatNotePath("Lesson 5", null)).toBe("Lesson 5.md");
  });

  it("does not double the .md extension", () => {
    expect(resolveSaveChatNotePath("Lesson 5.md", "German")).toBe(
      "German/Lesson 5.md",
    );
  });

  it("treats a name with slashes as vault-relative", () => {
    expect(resolveSaveChatNotePath("Inbox/Saved.md", "German")).toBe(
      "Inbox/Saved.md",
    );
  });

  it("falls back to Untitled for blank input", () => {
    expect(resolveSaveChatNotePath("  ", null)).toBe("Untitled.md");
  });
});
