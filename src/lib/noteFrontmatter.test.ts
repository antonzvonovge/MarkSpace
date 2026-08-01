import { describe, expect, it } from "vitest";
import {
  getNoteTags,
  mergeFrontmatter,
  noteBody,
  setNoteTags,
  splitFrontmatter,
  stampNoteTimestamps,
  withNoteBody,
} from "./noteFrontmatter";

describe("noteFrontmatter", () => {
  it("returns full text as body when there is no fence", () => {
    const md = "# Hello\n\nworld\n";
    expect(splitFrontmatter(md)).toEqual({
      data: null,
      body: md,
      hasFence: false,
      rawYaml: null,
    });
    expect(getNoteTags(md)).toEqual([]);
    expect(noteBody(md)).toBe(md);
  });

  it("parses list-form tags", () => {
    const md = `---
tags:
  - work
  - inbox
---

# Title
`;
    expect(getNoteTags(md)).toEqual(["work", "inbox"]);
    expect(noteBody(md)).toBe("\n# Title\n");
  });

  it("parses flow and scalar tags", () => {
    expect(getNoteTags("---\ntags: [a, b]\n---\n\n")).toEqual(["a", "b"]);
    expect(getNoteTags("---\ntags: solo\n---\n\nx")).toEqual(["solo"]);
    expect(getNoteTags("---\ntags: one, two\n---\n")).toEqual(["one", "two"]);
  });

  it("strips leading # and dedupes case-insensitively", () => {
    expect(
      getNoteTags('---\ntags: ["#Work", work, WORK]\n---\n'),
    ).toEqual(["Work"]);
  });

  it("preserves other keys when setting tags", () => {
    const md = `---
aliases:
  - aka
tags:
  - old
---

Body
`;
    const next = setNoteTags(md, ["new", "tag"]);
    expect(getNoteTags(next)).toEqual(["new", "tag"]);
    expect(splitFrontmatter(next).data?.aliases).toEqual(["aka"]);
    expect(noteBody(next)).toBe("\nBody\n");
  });

  it("removes fence when clearing tags and no other keys", () => {
    const md = `---
tags:
  - x
---

# Hi
`;
    expect(setNoteTags(md, [])).toBe("\n# Hi\n");
  });

  it("adds frontmatter when none existed", () => {
    const next = setNoteTags("# Hi\n", ["a"]);
    expect(next.startsWith("---\n")).toBe(true);
    expect(getNoteTags(next)).toEqual(["a"]);
    expect(noteBody(next)).toBe("# Hi\n");
  });

  it("mergeFrontmatter omits empty data", () => {
    expect(mergeFrontmatter(null, "body")).toBe("body");
    expect(mergeFrontmatter({}, "body")).toBe("body");
    expect(mergeFrontmatter({ tags: ["x"] }, "body")).toContain("tags:");
  });

  it("leaves unparseable fence untouched on setNoteTags", () => {
    const md = "---\n: bad: [yaml\n---\n\nBody\n";
    expect(setNoteTags(md, ["x"])).toBe(md);
    expect(noteBody(md)).toBe("\nBody\n");
  });

  it("adds created and updated timestamps to a note", () => {
    const now = new Date("2026-08-01T10:03:00.000Z");
    const next = stampNoteTimestamps("# Hi\n", now);

    expect(splitFrontmatter(next).data).toEqual({
      created: "2026-08-01T10:03:00.000Z",
      updated: "2026-08-01T10:03:00.000Z",
    });
    expect(noteBody(next)).toBe("# Hi\n");
  });

  it("preserves created and other keys while updating updated", () => {
    const md =
      "---\ncreated: 2026-07-01T08:00:00.000Z\naliases:\n  - aka\nupdated: 2026-07-02T08:00:00.000Z\n---\nBody\n";
    const next = stampNoteTimestamps(
      md,
      new Date("2026-08-01T10:03:00.000Z"),
    );
    const data = splitFrontmatter(next).data;

    expect(data?.created).toBe("2026-07-01T08:00:00.000Z");
    expect(data?.updated).toBe("2026-08-01T10:03:00.000Z");
    expect(data?.aliases).toEqual(["aka"]);
    expect(noteBody(next)).toBe("Body\n");
  });

  it("does not stamp unparseable frontmatter", () => {
    const md = "---\n: bad: [yaml\n---\n\nBody\n";
    expect(
      stampNoteTimestamps(md, new Date("2026-08-01T10:03:00.000Z")),
    ).toBe(md);
  });

  it("withNoteBody preserves frontmatter across Live edits", () => {
    const md = `---
tags:
  - a
---

Old
`;
    const next = withNoteBody(md, "New\n");
    expect(getNoteTags(next)).toEqual(["a"]);
    expect(noteBody(next)).toBe("New\n");
  });

  it("withNoteBody preserves unparseable fence", () => {
    const md = "---\n: bad: [yaml\n---\n\nOld\n";
    expect(withNoteBody(md, "New\n")).toBe("---\n: bad: [yaml\n---\nNew\n");
  });
});
