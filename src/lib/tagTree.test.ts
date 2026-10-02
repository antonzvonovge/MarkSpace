import { describe, expect, it } from "vitest";
import type { TreeNode } from "./vaultApi";
import {
  UNTAGGED_SELECTION,
  addTagToNotes,
  applyTagPrefix,
  applyTagPrefixToNotes,
  buildTagTree,
  collectTagDocumentPaths,
  documentsForSelection,
  flattenTagView,
  remapTagPrefix,
  tagInBranch,
} from "./tagTree";

const notes = [
  { path: "Notes/A.md", tags: ["language/georgian", "work"] },
  { path: "Notes/B.md", tags: ["language"] },
  { path: "Books/play.pdf", tags: ["language/georgian"] },
  { path: "Notes/C.md", tags: ["Work"] },
];

const tree: TreeNode = {
  name: "",
  path: "",
  isDir: true,
  children: [
    {
      name: "Notes",
      path: "Notes",
      isDir: true,
      children: [
        { name: "A.md", path: "Notes/A.md", isDir: false },
        { name: "B.md", path: "Notes/B.md", isDir: false },
        { name: "C.md", path: "Notes/C.md", isDir: false },
        { name: "D.md", path: "Notes/D.md", isDir: false },
      ],
    },
    {
      name: "Books",
      path: "Books",
      isDir: true,
      children: [{ name: "play.pdf", path: "Books/play.pdf", isDir: false }],
    },
    {
      name: "Tasks",
      path: "Tasks",
      isDir: true,
      children: [{ name: "t.md", path: "Tasks/t.md", isDir: false }],
    },
  ],
};

describe("buildTagTree", () => {
  it("synthesizes parents and sorts segments", () => {
    const nodes = buildTagTree(["language/georgian", "work", "language"]);
    expect(nodes.map((node) => node.path)).toEqual(["language", "work"]);
    expect(nodes[0]?.children.map((node) => node.name)).toEqual(["georgian"]);
  });

  it("keeps the first spelling of a path", () => {
    const nodes = buildTagTree(["Language/Georgian", "language/georgian"]);
    expect(nodes[0]?.path).toBe("Language");
    expect(nodes[0]?.children[0]?.path).toBe("Language/Georgian");
  });
});

describe("documentsForSelection", () => {
  it("includes descendant notes for a parent tag", () => {
    expect(
      documentsForSelection(notes, [], "language", false).map((path) => path),
    ).toEqual(["Notes/A.md", "Notes/B.md", "Books/play.pdf"]);
  });

  it("hides subtag notes unless the exact tag is present", () => {
    expect(
      documentsForSelection(notes, [], "language", true).map((path) => path),
    ).toEqual(["Notes/B.md"]);
    expect(tagInBranch("language/georgian", "language", true)).toBe(false);
  });

  it("lists vault documents that are missing from the tag index", () => {
    const docs = collectTagDocumentPaths(tree);
    expect(docs).not.toContain("Tasks/t.md");
    expect(
      documentsForSelection(notes, docs, UNTAGGED_SELECTION, false),
    ).toEqual(["Notes/D.md"]);
  });

  it("returns nothing until a row is selected", () => {
    expect(documentsForSelection(notes, ["Notes/D.md"], null, false)).toEqual(
      [],
    );
  });
});

describe("applyTagPrefix", () => {
  it("renames a branch and merges case-insensitive duplicates", () => {
    expect(remapTagPrefix("language/georgian", "language", "tongues")).toBe(
      "tongues/georgian",
    );
    expect(applyTagPrefix(["language", "language/georgian", "work"], "language", "work")).toEqual([
      "work",
      "work/georgian",
    ]);
  });

  it("deletes a branch and drops notes left with no tags", () => {
    expect(applyTagPrefix(["language/georgian", "work"], "language", null)).toEqual([
      "work",
    ]);
    expect(applyTagPrefixToNotes(notes, "work", null).map((entry) => entry.path)).toEqual([
      "Notes/A.md",
      "Notes/B.md",
      "Books/play.pdf",
    ]);
  });
});

describe("flattenTagView", () => {
  it("omits the note list until a tag is selected", () => {
    const rows = flattenTagView({
      tree: buildTagTree(["language/georgian"]),
      expanded: [],
      notes,
      documentPaths: [],
      selection: null,
      hideSubtagNotes: false,
    });
    expect(rows.some((row) => row.kind === "note")).toBe(false);
    expect(rows[0]?.kind).toBe("untagged");
  });

  it("nests expanded children and lists matching notes", () => {
    const rows = flattenTagView({
      tree: buildTagTree(["language/georgian"]),
      expanded: ["language"],
      notes,
      documentPaths: [],
      selection: "language",
      hideSubtagNotes: false,
    });
    const tags = rows.filter((row) => row.kind === "tag");
    expect(tags.map((row) => (row.kind === "tag" ? row.name : ""))).toEqual([
      "language",
      "georgian",
    ]);
    expect(rows.filter((row) => row.kind === "note")).toHaveLength(3);
  });

  it("omits documents when the file list is a separate column", () => {
    const rows = flattenTagView({
      tree: buildTagTree(["language/georgian"]),
      expanded: ["language"],
      notes,
      documentPaths: [],
      selection: "language",
      hideSubtagNotes: false,
      includeDocuments: false,
    });
    expect(rows.some((row) => row.kind === "note" || row.kind === "divider")).toBe(
      false,
    );
  });
});

describe("addTagToNotes", () => {
  it("appends a tag without dropping the others", () => {
    const next = addTagToNotes(notes, "Notes/B.md", "work");
    expect(next.find((entry) => entry.path === "Notes/B.md")?.tags).toEqual([
      "language",
      "work",
    ]);
    expect(addTagToNotes(notes, "Notes/B.md", "Language")).toBe(notes);
  });
});
