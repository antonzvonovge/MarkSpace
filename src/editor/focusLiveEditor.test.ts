import { describe, expect, it } from "vitest";
import { isEmptyLiveEditorClick } from "./focusLiveEditor";

describe("isEmptyLiveEditorClick", () => {
  it("treats canvas / main chrome as empty clicks", () => {
    const main = document.createElement("div");
    main.className = "editor-main";
    const canvas = document.createElement("div");
    canvas.className = "editor-canvas";
    main.appendChild(canvas);
    document.body.appendChild(main);

    expect(isEmptyLiveEditorClick(canvas)).toBe(true);
    expect(isEmptyLiveEditorClick(main)).toBe(true);

    main.remove();
  });

  it("ignores real block content and controls", () => {
    const main = document.createElement("div");
    main.className = "editor-main";
    const content = document.createElement("div");
    content.className = "bn-block-content";
    main.appendChild(content);
    const link = document.createElement("a");
    link.href = "#";
    main.appendChild(link);
    document.body.appendChild(main);

    expect(isEmptyLiveEditorClick(content)).toBe(false);
    expect(isEmptyLiveEditorClick(link)).toBe(false);

    main.remove();
  });
});
