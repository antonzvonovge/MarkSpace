import { describe, expect, it } from "vitest";
import {
  answersMatch,
  collectProjectMddictPaths,
  practiceKindLabel,
  shuffleInPlace,
} from "./dictPractice";
import type { TreeNode } from "../../lib/vaultApi";

describe("dictPractice", () => {
  it("collects mddict paths under a project", () => {
    const tree: TreeNode = {
      name: "",
      path: "",
      isDir: true,
      children: [
        {
          name: "German",
          path: "German",
          isDir: true,
          children: [
            {
              name: "verbs.mddict",
              path: "German/verbs.mddict",
              isDir: false,
            },
            {
              name: "nested",
              path: "German/nested",
              isDir: true,
              children: [
                {
                  name: "nouns.mddict",
                  path: "German/nested/nouns.mddict",
                  isDir: false,
                },
              ],
            },
            { name: "note.md", path: "German/note.md", isDir: false },
          ],
        },
        {
          name: "Other",
          path: "Other",
          isDir: true,
          children: [
            { name: "x.mddict", path: "Other/x.mddict", isDir: false },
          ],
        },
      ],
    };
    expect(collectProjectMddictPaths(tree, "German")).toEqual([
      "German/nested/nouns.mddict",
      "German/verbs.mddict",
    ]);
    expect(collectProjectMddictPaths(tree, "Missing")).toEqual([]);
  });

  it("matches answers case-insensitively", () => {
    expect(answersMatch("Haus", " haus ")).toBe(true);
    expect(answersMatch("Haus", "home")).toBe(false);
  });

  it("labels exercise kinds", () => {
    expect(practiceKindLabel("cloze")).toBe("Fill the blank");
  });

  it("shuffles without dropping items", () => {
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    shuffleInPlace(copy);
    expect(copy.sort()).toEqual(arr);
  });
});
