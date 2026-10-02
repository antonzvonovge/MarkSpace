/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { emptySidebarCreateParent } from "./emptyCreateParent";

function clickTarget(html: string): Element {
  document.body.innerHTML = html;
  const el = document.body.querySelector("[data-hit]");
  if (!el) throw new Error("missing hit target");
  return el;
}

describe("emptySidebarCreateParent", () => {
  it("creates at the vault root when the click is empty file-list space", () => {
    const target = clickTarget(
      `<div class="tree-scroll"><div data-hit></div></div>`,
    );
    expect(emptySidebarCreateParent(target, "Incoming")).toBe("");
  });

  it("creates at the vault root for the workspace section", () => {
    const target = clickTarget(
      `<div class="workspace-section"><div data-hit></div></div>`,
    );
    expect(emptySidebarCreateParent(target, "Incoming")).toBe("");
  });

  it("keeps the selected folder for empty space inside Incoming", () => {
    const target = clickTarget(
      `<div class="tree-scroll"><div class="incoming-section"><div data-hit></div></div></div>`,
    );
    expect(emptySidebarCreateParent(target, "Incoming")).toBe("Incoming");
  });

  it("keeps the selected folder outside the file list", () => {
    const target = clickTarget(`<div class="brand-block"><div data-hit></div></div>`);
    expect(emptySidebarCreateParent(target, "Notes")).toBe("Notes");
  });
});
