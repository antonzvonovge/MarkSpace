import { describe, expect, it, beforeEach } from "vitest";
import {
  clampOutlineWidth,
  loadDocOutlineUi,
  outlineUiStorageKey,
  saveDocOutlineCollapsed,
  saveDocOutlineOpen,
  saveDocOutlineWidth,
  OUTLINE_WIDTH_DEFAULT,
} from "./outlineUiState";

const STORAGE_KEY = "markspace-outline-ui-v1";

beforeEach(() => {
  localStorage.clear();
});

describe("outlineUiState", () => {
  it("clamps width", () => {
    expect(clampOutlineWidth(50)).toBe(140);
    expect(clampOutlineWidth(900)).toBe(480);
    expect(clampOutlineWidth(233.7)).toBe(234);
  });

  it("namespaces by vault + note path", () => {
    expect(outlineUiStorageKey("/vault", "a.md")).toBe("/vault\na.md");
    expect(outlineUiStorageKey(null, "a.md")).toBe("\na.md");
  });

  it("persists open, width and collapsed per document", () => {
    saveDocOutlineOpen("/v", "one.md", true);
    saveDocOutlineWidth("/v", "one.md", 300);
    saveDocOutlineCollapsed("/v", "one.md", ["1:A", "2:B"]);
    saveDocOutlineWidth("/v", "two.md", 180);

    expect(loadDocOutlineUi("/v", "one.md")).toEqual({
      open: true,
      width: 300,
      collapsed: ["1:A", "2:B"],
    });
    expect(loadDocOutlineUi("/v", "two.md")).toEqual({
      open: false,
      width: 180,
      collapsed: [],
    });
    expect(loadDocOutlineUi("/v", "missing.md")).toEqual({
      open: false,
      width: OUTLINE_WIDTH_DEFAULT,
      collapsed: [],
    });
  });

  it("does not leak state across vaults with the same note path", () => {
    saveDocOutlineOpen("/v1", "note.md", true);
    saveDocOutlineCollapsed("/v1", "note.md", ["1:Only"]);
    expect(loadDocOutlineUi("/v2", "note.md")).toEqual({
      open: false,
      width: OUTLINE_WIDTH_DEFAULT,
      collapsed: [],
    });
  });

  it("keeps other fields when updating one", () => {
    saveDocOutlineOpen("/v", "n.md", true);
    saveDocOutlineWidth("/v", "n.md", 260);
    saveDocOutlineCollapsed("/v", "n.md", ["1:X"]);
    expect(loadDocOutlineUi("/v", "n.md")).toEqual({
      open: true,
      width: 260,
      collapsed: ["1:X"],
    });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<
      string,
      { width: number; open: boolean }
    >;
    expect(stored["/v\nn.md"].width).toBe(260);
    expect(stored["/v\nn.md"].open).toBe(true);
  });
});
