import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyImagePreviewWidths,
  collectImageSizeRefs,
  restoreImagePreviewWidthsFromAlt,
} from "../../lib/imageMarkdown";
import {
  markdownToNestedBlocks,
  nestedHtmlToMarkdown,
} from "../../lib/nestedListMarkdown";
import { noteEditorSchema, type NoteEditor } from "../schema";

let editor: NoteEditor | null = null;

afterEach(() => {
  editor?._tiptapEditor.destroy();
  editor = null;
});

function imageProps(blocks: { type: string; props: Record<string, unknown> }[]) {
  const image = blocks.find((block) => block.type === "image");
  return image?.props;
}

describe("markspace image block", () => {
  it("restores a stretched size from markdown and writes it back", () => {
    editor = BlockNoteEditor.create({ schema: noteEditorSchema });
    const blocks = restoreImagePreviewWidthsFromAlt(
      markdownToNestedBlocks(editor, "![photo|320x180](pic.png)\n"),
    );
    expect(imageProps(blocks as { type: string; props: Record<string, unknown> }[])).toMatchObject({
      name: "photo",
      previewWidth: 320,
      previewHeight: 180,
    });

    editor.replaceBlocks(editor.document, blocks);
    const md = applyImagePreviewWidths(
      nestedHtmlToMarkdown(editor.blocksToHTMLLossy(editor.document)),
      collectImageSizeRefs(editor.document),
    );
    expect(md).toContain("![photo|320x180](pic.png)");
  });

  it("reads height from a captioned figure", () => {
    editor = BlockNoteEditor.create({ schema: noteEditorSchema });
    const blocks = editor.tryParseHTMLToBlocks(
      '<figure><img alt="cap" src="pic.png" width="400" height="120"><figcaption>cap</figcaption></figure>',
    );
    expect(imageProps(blocks as { type: string; props: Record<string, unknown> }[])).toMatchObject({
      previewWidth: 400,
      previewHeight: 120,
      caption: "cap",
    });
  });

  it("renders a square handle on each edge and corner", () => {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
    editor = BlockNoteEditor.create({ schema: noteEditorSchema });
    editor.replaceBlocks(editor.document, [
      {
        type: "image",
        props: { url: "pic.png", name: "photo", previewWidth: 200 },
      },
    ]);
    const view = render(createElement(BlockNoteView, { editor }));
    const handles = view.container.querySelectorAll(".image-resize-handle");
    expect(
      [...handles].map((node) => node.getAttribute("data-handle")).sort(),
    ).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
    view.unmount();
  });

  it("does not crash when the image url is still empty", () => {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
    editor = BlockNoteEditor.create({ schema: noteEditorSchema });
    editor.replaceBlocks(editor.document, [
      { type: "image", props: { name: "photo.png", url: "" } },
    ]);
    const view = render(createElement(BlockNoteView, { editor }));
    expect(view.container.querySelector(".bn-add-file-button")).not.toBeNull();
    view.unmount();
  });
});
