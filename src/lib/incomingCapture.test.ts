import { describe, expect, it } from "vitest";
import {
  buildCaptureMarkdown,
  buildCapturePath,
  formatCaptureFilenameStamp,
} from "./incomingCapture";
import { splitFrontmatter } from "./noteFrontmatter";

const FIXED = new Date(2026, 8, 1, 16, 18, 0);

describe("incomingCapture", () => {
  it("formats local filename stamp", () => {
    expect(formatCaptureFilenameStamp(FIXED)).toBe("2026-09-01 16-18");
  });

  it("builds capture path with optional body slug", () => {
    expect(buildCapturePath("", FIXED)).toBe("Incoming/2026-09-01 16-18.md");
    expect(buildCapturePath("Call mom tomorrow", FIXED)).toBe(
      "Incoming/2026-09-01 16-18 — Call-mom-tomorrow.md",
    );
  });

  it("builds markdown with frontmatter, tags, quote, and source link", () => {
    const md = buildCaptureMarkdown({
      body: "Follow up on this idea",
      quote: "selected passage",
      sourcePath: "Work/Notes.md",
      now: FIXED,
    });
    const split = splitFrontmatter(md);
    expect(split.data?.captured).toBe(FIXED.toISOString());
    expect(split.data?.source).toBe("Work/Notes.md");
    expect(split.data?.tags).toEqual(["inbox"]);
    expect(split.body).toContain("Follow up on this idea");
    expect(split.body).toContain("> selected passage");
    expect(split.body).toContain("from [[Notes]]");
  });

  it("allows quote-only capture", () => {
    const md = buildCaptureMarkdown({
      body: "",
      quote: "Just this",
      sourcePath: "Journal/day.md",
      now: FIXED,
    });
    expect(md).toContain("> Just this");
    expect(md).toContain("tags:");
  });
});
