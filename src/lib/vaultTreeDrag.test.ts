/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginVaultTreeDrag,
  clearVaultTreeDrag,
  dispatchVaultTreePointerDrop,
  endVaultTreeDrag,
  getActiveVaultTreeDrag,
  normalizeVaultTreeDragPath,
  subscribeVaultTreeDrag,
  VAULT_TREE_POINTER_DROP_EVENT,
  type VaultTreePointerDropDetail,
} from "./vaultTreeDrag";

describe("normalizeVaultTreeDragPath", () => {
  it("adds a trailing slash for folders", () => {
    expect(normalizeVaultTreeDragPath("Notes", true)).toBe("Notes/");
    expect(normalizeVaultTreeDragPath("Notes/", true)).toBe("Notes/");
  });

  it("leaves file paths unchanged", () => {
    expect(normalizeVaultTreeDragPath("Notes/a.md", false)).toBe("Notes/a.md");
  });
});

describe("vaultTreeDrag bridge", () => {
  afterEach(() => {
    clearVaultTreeDrag();
    vi.useRealTimers();
  });

  it("notifies subscribers on begin and clear", () => {
    const seen: Array<string | null> = [];
    const unsub = subscribeVaultTreeDrag((path) => {
      seen.push(path);
    });
    expect(seen).toEqual([null]);
    beginVaultTreeDrag("Notes/a.md");
    expect(getActiveVaultTreeDrag()).toBe("Notes/a.md");
    expect(seen).toEqual([null, "Notes/a.md"]);
    clearVaultTreeDrag();
    expect(seen).toEqual([null, "Notes/a.md", null]);
    unsub();
  });

  it("defers clear on endVaultTreeDrag", () => {
    vi.useFakeTimers();
    beginVaultTreeDrag("x.md");
    endVaultTreeDrag();
    expect(getActiveVaultTreeDrag()).toBe("x.md");
    vi.advanceTimersByTime(50);
    expect(getActiveVaultTreeDrag()).toBeNull();
  });
});

describe("dispatchVaultTreePointerDrop", () => {
  afterEach(() => {
    clearVaultTreeDrag();
  });

  it("returns true when a listener prevents default", () => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<VaultTreePointerDropDetail>).detail;
      expect(detail.path).toBe("Notes/a.md");
      expect(detail.clientX).toBe(10);
      expect(detail.clientY).toBe(20);
      event.preventDefault();
    };
    window.addEventListener(VAULT_TREE_POINTER_DROP_EVENT, handler);
    try {
      expect(dispatchVaultTreePointerDrop("Notes/a.md", 10, 20)).toBe(true);
    } finally {
      window.removeEventListener(VAULT_TREE_POINTER_DROP_EVENT, handler);
    }
  });

  it("returns false when nobody handles the drop", () => {
    expect(dispatchVaultTreePointerDrop("Notes/a.md", 1, 2)).toBe(false);
  });
});
