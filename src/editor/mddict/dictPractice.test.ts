import { describe, expect, it } from "vitest";
import {
  answersMatch,
  collectProjectMddictPaths,
  collectVaultMddictPaths,
  filterMddictPathsForLearningLanguage,
  practiceKindLabel,
  shuffleInPlace,
  sortMddictPathsForPicker,
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

  it("collects all vault dictionaries and sorts the picker list", () => {
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
    expect(collectVaultMddictPaths(tree)).toEqual([
      "German/verbs.mddict",
      "Other/x.mddict",
    ]);
    expect(
      sortMddictPathsForPicker(collectVaultMddictPaths(tree), "Other/note.md"),
    ).toEqual(["Other/x.mddict", "German/verbs.mddict"]);
  });

  it("keeps non-language-project dictionaries and matching learning-language ones", () => {
    const paths = [
      "German/verbs.mddict",
      "Georgian/words.mddict",
      "Notes/misc.mddict",
      "loose.mddict",
    ];
    const props = {
      German: { projectType: "languageLearning", learningLanguage: "de" },
      Georgian: { projectType: "languageLearning", learningLanguage: "ka" },
      Notes: { projectType: "knowledgeBase", learningLanguage: "" },
    };
    expect(filterMddictPathsForLearningLanguage(paths, props, "de")).toEqual([
      "German/verbs.mddict",
      "Notes/misc.mddict",
      "loose.mddict",
    ]);
    expect(filterMddictPathsForLearningLanguage(paths, props, "ka")).toEqual([
      "Georgian/words.mddict",
      "Notes/misc.mddict",
      "loose.mddict",
    ]);
  });

  it("does not hide a language-learning project with no language set", () => {
    expect(
      filterMddictPathsForLearningLanguage(
        ["Unset/words.mddict"],
        { Unset: { projectType: "languageLearning", learningLanguage: "" } },
        "en",
      ),
    ).toEqual(["Unset/words.mddict"]);
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
