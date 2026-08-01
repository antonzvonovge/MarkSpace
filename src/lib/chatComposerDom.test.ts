import { describe, expect, it } from "vitest";
import {
  chipLabelForPath,
  createPathChipElement,
  createSkillChipElement,
  extractSkillIdsFromDraft,
  renderComposerFromDraft,
  replaceSlashWithSkillChip,
  serializeComposer,
  unwrapComposerMarkers,
  unwrapVaultPathMarkers,
  wrapSkillMarker,
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

describe("skill markers", () => {
  it("wraps, extracts, and unwraps skill chips", () => {
    expect(wrapSkillMarker("meeting-notes")).toBe("⦃meeting-notes⦄");
    expect(extractSkillIdsFromDraft("use ⦃meeting-notes⦄ and ⦃a⦄")).toEqual([
      "meeting-notes",
      "a",
    ]);
    expect(
      unwrapComposerMarkers("use ⦃meeting-notes⦄ on ⟦Notes/a.md⟧"),
    ).toBe("use /meeting-notes on Notes/a.md");
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

  it("round-trips skill chips", () => {
    const root = document.createElement("div");
    renderComposerFromDraft(root, "run ⦃meeting-notes⦄ please");
    expect(serializeComposer(root)).toBe("run ⦃meeting-notes⦄ please");
    const chip = root.querySelector(".chat-skill-chip") as HTMLElement;
    expect(chip?.textContent).toBe("/meeting-notes");
    expect(chip?.dataset.skillId).toBe("meeting-notes");
    expect(createSkillChipElement("x").classList.contains("chat-skill-chip")).toBe(
      true,
    );
  });
});

describe("replaceSlashWithSkillChip", () => {
  it("replaces a leading slash using a saved range even if caret moved", () => {
    document.body.replaceChildren();
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.appendChild(root);
    root.appendChild(document.createTextNode("/ hello"));

    const text = root.firstChild as Text;
    const slashRange = document.createRange();
    slashRange.setStart(text, 0);
    slashRange.setEnd(text, 1);

    // Simulate lost selection at end of composer.
    const end = document.createRange();
    end.setStart(text, text.length);
    end.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(end);

    replaceSlashWithSkillChip(root, "meeting-notes", slashRange);
    expect(serializeComposer(root)).toBe("⦃meeting-notes⦄ hello");
  });
});
