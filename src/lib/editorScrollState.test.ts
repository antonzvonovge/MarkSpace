import { describe, expect, it, beforeEach } from "vitest";
import {
  editorScrollStorageKey,
  loadDocEditorScroll,
  saveDocEditorScroll,
} from "./editorScrollState";

const STORAGE_KEY = "markspace-editor-scroll-v1";

beforeEach(() => {
  localStorage.clear();
});

describe("editorScrollState", () => {
  it("namespaces by vault + note path", () => {
    expect(editorScrollStorageKey("/vault", "a.md")).toBe("/vault\na.md");
    expect(editorScrollStorageKey(null, "a.md")).toBe("\na.md");
  });

  it("persists live and source independently per document", () => {
    saveDocEditorScroll("/v", "one.md", "live", 420);
    saveDocEditorScroll("/v", "one.md", "source", 88);
    saveDocEditorScroll("/v", "two.md", "live", 12);

    expect(loadDocEditorScroll("/v", "one.md", "live")).toBe(420);
    expect(loadDocEditorScroll("/v", "one.md", "source")).toBe(88);
    expect(loadDocEditorScroll("/v", "two.md", "live")).toBe(12);
    expect(loadDocEditorScroll("/v", "two.md", "source")).toBe(0);
    expect(loadDocEditorScroll("/v", "missing.md", "live")).toBe(0);
  });

  it("does not leak state across vaults with the same note path", () => {
    saveDocEditorScroll("/v1", "note.md", "live", 900);
    expect(loadDocEditorScroll("/v2", "note.md", "live")).toBe(0);
  });

  it("clamps invalid values and keeps the other pane", () => {
    saveDocEditorScroll("/v", "n.md", "live", 260.7);
    saveDocEditorScroll("/v", "n.md", "source", -40);
    expect(loadDocEditorScroll("/v", "n.md", "live")).toBe(261);
    expect(loadDocEditorScroll("/v", "n.md", "source")).toBe(0);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<
      string,
      { live: number; source: number }
    >;
    expect(stored["/v\nn.md"].live).toBe(261);
    expect(stored["/v\nn.md"].source).toBe(0);
  });
});
