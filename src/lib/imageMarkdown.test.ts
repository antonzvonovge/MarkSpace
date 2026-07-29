import { describe, expect, it } from "vitest";
import {
  applyImagePreviewWidths,
  collectImageSizeRefs,
  restoreImagePreviewWidthsFromAlt,
} from "./imageMarkdown";

describe("imageMarkdown", () => {
  it("collects nested image preview widths", () => {
    const refs = collectImageSizeRefs([
      {
        type: "paragraph",
        children: [
          {
            type: "image",
            props: { url: "a.png", name: "A", previewWidth: 240 },
          },
        ],
      },
      {
        type: "image",
        props: { url: "b.png", name: "", previewWidth: undefined },
      },
    ]);

    expect(refs).toEqual([
      { url: "a.png", name: "A", previewWidth: 240 },
      { url: "b.png", name: "", previewWidth: undefined },
    ]);
  });

  it("projects previewWidth into Obsidian-style markdown images", () => {
    const md = applyImagePreviewWidths("![photo](pic.png)\n\n![other](x.png)\n", [
      { url: "pic.png", name: "photo", previewWidth: 320 },
      { url: "x.png", name: "other" },
    ]);

    expect(md).toBe("![photo|320](pic.png)\n\n![other](x.png)\n");
  });

  it("projects width-only alt when name is empty", () => {
    const md = applyImagePreviewWidths("![](pic.png)\n", [
      { url: "pic.png", name: "", previewWidth: 180 },
    ]);
    expect(md).toBe("![180](pic.png)\n");
  });

  it("injects width into captioned HTML figures", () => {
    const md = applyImagePreviewWidths(
      '<figure><img alt="cap" src="pic.png"><figcaption>cap</figcaption></figure>\n',
      [{ url: "pic.png", name: "cap", previewWidth: 400 }],
    );
    expect(md).toContain('width="400"');
    expect(md).toContain('src="pic.png"');
    expect(md).toContain("<figcaption>cap</figcaption>");
  });

  it("restores previewWidth from Obsidian-style alt on import", () => {
    const blocks = restoreImagePreviewWidthsFromAlt([
      {
        type: "image",
        props: { url: "pic.png", name: "photo|320" },
      },
      {
        type: "image",
        props: { url: "x.png", name: "180" },
      },
      {
        type: "image",
        props: { url: "y.png", name: "keep|not-a-size" },
      },
    ]);

    expect(blocks[0]?.props).toMatchObject({
      name: "photo",
      previewWidth: 320,
    });
    expect(blocks[1]?.props).toMatchObject({
      name: "",
      previewWidth: 180,
    });
    expect(blocks[2]?.props).toEqual({
      url: "y.png",
      name: "keep|not-a-size",
    });
  });

  it("prefers an existing previewWidth over alt size", () => {
    const [block] = restoreImagePreviewWidthsFromAlt([
      {
        type: "image",
        props: { url: "pic.png", name: "photo|100", previewWidth: 400 },
      },
    ]);
    expect(block?.props).toMatchObject({
      name: "photo",
      previewWidth: 400,
    });
  });
});
