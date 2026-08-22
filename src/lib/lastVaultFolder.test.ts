import { describe, expect, it, beforeEach } from "vitest";
import type { TreeNode } from "../lib/vaultApi";
import {
  ancestorFolderPaths,
  folderExistsInTree,
  getLastVaultFolder,
  setLastVaultFolder,
} from "./lastVaultFolder";

const tree: TreeNode = {
  name: "",
  path: "",
  isDir: true,
  children: [
    {
      name: "English",
      path: "English",
      isDir: true,
      children: [
        {
          name: "IELTS",
          path: "English/IELTS",
          isDir: true,
          children: [
            {
              name: "Listening",
              path: "English/IELTS/Listening",
              isDir: true,
              children: [],
            },
          ],
        },
      ],
    },
  ],
};

describe("lastVaultFolder", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
      },
    });
  });

  it("round-trips the last folder", () => {
    expect(getLastVaultFolder()).toBe("");
    setLastVaultFolder("/English/IELTS/Listening/");
    expect(getLastVaultFolder()).toBe("English/IELTS/Listening");
  });

  it("finds existing folders and rejects files/missing", () => {
    expect(folderExistsInTree(tree, "English/IELTS/Listening")).toBe(true);
    expect(folderExistsInTree(tree, "English/Missing")).toBe(false);
    expect(folderExistsInTree(tree, "")).toBe(false);
  });

  it("lists ancestors for expanding the browse tree", () => {
    expect(ancestorFolderPaths("English/IELTS/Listening")).toEqual([
      "English",
      "English/IELTS",
    ]);
  });
});
