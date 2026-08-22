import { describe, expect, it } from "vitest";
import {
  ancestorFolderPaths,
  collectChatFolderAbouts,
  collectFolderAbouts,
  folderOfVaultPath,
  formatFolderContextBlock,
  withFolderContext,
} from "./folderContext";
import { emptyProjectProperties } from "./vaultApi";
import { wrapVaultPathMarker as wrapPath } from "./chatComposerDom";

function props(
  entries: Record<string, string>,
): Record<string, ReturnType<typeof emptyProjectProperties>> {
  const map: Record<string, ReturnType<typeof emptyProjectProperties>> = {};
  for (const [path, about] of Object.entries(entries)) {
    map[path] = { ...emptyProjectProperties(path), about };
  }
  return map;
}

describe("folderOfVaultPath", () => {
  it("uses parent for files and the folder itself for folders", () => {
    expect(folderOfVaultPath("A/B/note.md")).toBe("A/B");
    expect(folderOfVaultPath("A/B/")).toBe("A/B");
    expect(folderOfVaultPath("Spanish")).toBe("Spanish");
    expect(folderOfVaultPath("A/B/.folder.md")).toBe("A/B");
    expect(folderOfVaultPath("note.md")).toBe(null);
  });
});

describe("ancestorFolderPaths", () => {
  it("lists deepest first", () => {
    expect(ancestorFolderPaths("A/B/C")).toEqual(["A/B/C", "A/B", "A"]);
  });
});

describe("collectFolderAbouts", () => {
  it("unions chains and drops empty abouts", () => {
    const map = props({
      A: "Project instructions",
      "A/B": "Nested instructions",
      Other: "Unrelated",
    });
    expect(collectFolderAbouts(["A/B/note.md"], map)).toEqual([
      { path: "A/B", about: "Nested instructions" },
      { path: "A", about: "Project instructions" },
    ]);
  });

  it("does not duplicate the same path from several seeds", () => {
    const map = props({ A: "Once" });
    const out = collectFolderAbouts(["A", "A/note.md", "A/"], map);
    expect(out).toEqual([{ path: "A", about: "Once" }]);
  });
});

describe("collectChatFolderAbouts", () => {
  it("includes composer chips", () => {
    const map = props({
      A: "A about",
      B: "B about",
    });
    const composer = `see ${wrapPath("B/file.md")}`;
    const out = collectChatFolderAbouts({
      activePath: "A/open.md",
      projectPath: "A",
      composerText: composer,
      propsByPath: map,
    });
    expect(out.map((e) => e.path).sort()).toEqual(["A", "B"]);
  });
});

describe("formatFolderContextBlock", () => {
  it("states that the model must follow instructions", () => {
    const block = formatFolderContextBlock([
      { path: "A/B", about: "Use tables" },
    ]);
    expect(block).toContain("description and instructions");
    expect(block).toContain("deeper folder wins");
    expect(block).toContain("A/B");
    expect(block).toContain("Use tables");
    expect(withFolderContext("You are X.", [
      { path: "A/B", about: "Use tables" },
    ])).toContain("You are X.");
  });
});
