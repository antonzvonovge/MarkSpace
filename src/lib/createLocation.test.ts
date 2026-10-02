import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyProjectProperties,
  type ProjectProperties,
  type TreeNode,
} from "./vaultApi";
import {
  getLastCreateFolder,
  isCreateFolderAllowed,
  resolveCreateFolder,
  setLastCreateFolder,
} from "./createLocation";

const tree: TreeNode = {
  name: "",
  path: "",
  isDir: true,
  children: [
    { name: "Incoming", path: "Incoming", isDir: true, children: [] },
    {
      name: "English",
      path: "English",
      isDir: true,
      children: [
        {
          name: "Notes",
          path: "English/Notes",
          isDir: true,
          children: [],
        },
      ],
    },
  ],
};

describe("createLocation", () => {
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

  it("defaults to Incoming", () => {
    expect(getLastCreateFolder()).toBe("");
    expect(resolveCreateFolder(tree)).toBe("Incoming");
  });

  it("reuses the last folder when it still exists", () => {
    setLastCreateFolder("/English/Notes/");
    expect(getLastCreateFolder()).toBe("English/Notes");
    expect(resolveCreateFolder(tree)).toBe("English/Notes");
  });

  it("falls back to Incoming when the last folder is gone", () => {
    setLastCreateFolder("Missing/Place");
    expect(resolveCreateFolder(tree)).toBe("Incoming");
  });

  it("rejects Tasks, Routines, and diary projects", () => {
    const withReserved: TreeNode = {
      ...tree,
      children: [
        ...(tree.children ?? []),
        { name: "Tasks", path: "Tasks", isDir: true, children: [] },
        { name: "Routines", path: "Routines", isDir: true, children: [] },
        {
          name: "Journal",
          path: "Journal",
          isDir: true,
          children: [
            { name: "2026", path: "Journal/2026", isDir: true, children: [] },
          ],
        },
      ],
    };
    const props: Record<string, ProjectProperties> = {
      Journal: { ...emptyProjectProperties("Journal"), projectType: "diary" },
    };
    expect(isCreateFolderAllowed("Tasks", props)).toBe(false);
    expect(isCreateFolderAllowed("Tasks/Inbox", props)).toBe(false);
    expect(isCreateFolderAllowed("Routines", props)).toBe(false);
    expect(isCreateFolderAllowed("Journal", props)).toBe(false);
    expect(isCreateFolderAllowed("Journal/2026", props)).toBe(false);
    expect(isCreateFolderAllowed("English/Notes", props)).toBe(true);

    setLastCreateFolder("Journal/2026");
    expect(resolveCreateFolder(withReserved, props)).toBe("Incoming");
  });
});
