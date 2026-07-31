import { describe, expect, it } from "vitest";
import {
  chipLabelForPath,
  createPathChipElement,
  renderComposerFromDraft,
  serializeComposer,
  unwrapVaultPathMarkers,
  wrapVaultPathMarker,
} from "./chatComposerDom";

describe("vault path markers", () => {
  it("wraps and unwraps paths", () => {
    expect(wrapVaultPathMarker("Notes/todo.md")).toBe("⟦Notes/todo.md⟧");
    expect(unwrapVaultPathMarkers("see ⟦Notes/todo.md⟧ and ⟦Projects/⟧")).toBe(
      "see Notes/todo.md and Projects/",
    );
  });

  it("strips close markers from paths when wrapping", () => {
    expect(wrapVaultPathMarker("a⟧b")).toBe("⟦ab⟧");
  });
});

describe("chipLabelForPath", () => {
  it("uses basename for files and folders", () => {
    expect(chipLabelForPath("Notes/todo.md")).toBe("todo.md");
    expect(chipLabelForPath("Projects/ideas/")).toBe("ideas/");
    expect(chipLabelForPath("solo.md")).toBe("solo.md");
  });

  it("truncates long names with ellipsis, keeps extension", () => {
    expect(
      chipLabelForPath("Notes/very-long-document-name-here.md"),
    ).toBe("very-long-do….md");
    expect(chipLabelForPath("Projects/super-long-folder-name/")).toBe(
      "super-long-fold…/",
    );
  });
});

describe("serialize / render composer", () => {
  it("round-trips text and chips", () => {
    const root = document.createElement("div");
    renderComposerFromDraft(root, "Look at ⟦Notes/todo.md⟧ please");
    expect(serializeComposer(root)).toBe("Look at ⟦Notes/todo.md⟧ please");
    expect(root.querySelector(".chat-path-chip")?.textContent).toBe("todo.md");
    expect(
      (root.querySelector(".chat-path-chip") as HTMLElement).dataset.vaultPath,
    ).toBe("Notes/todo.md");
  });

  it("round-trips newlines and folder chips", () => {
    const root = document.createElement("div");
    renderComposerFromDraft(root, "a\n⟦Projects/⟧\nb");
    expect(serializeComposer(root)).toBe("a\n⟦Projects/⟧\nb");
    expect(root.querySelector(".chat-path-chip.is-dir")?.textContent).toBe(
      "Projects/",
    );
  });

  it("stores full path for the model, shows short label", () => {
    const chip = createPathChipElement(
      "Folder/very-long-document-name-here.md",
    );
    expect(chip.contentEditable).toBe("false");
    expect(chip.title).toBe("");
    expect(chip.dataset.vaultPath).toBe(
      "Folder/very-long-document-name-here.md",
    );
    expect(chip.textContent).toBe("very-long-do….md");
    expect(chip.classList.contains("chat-path-chip")).toBe(true);
  });
});
