import { describe, expect, it } from "vitest";
import {
  commentQuoteLabel,
  LEAF_PLACEHOLDER,
  leafIdentity,
} from "./commentAnchors";
import { Node, Schema } from "@tiptap/pm/model";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    image: {
      group: "block",
      atom: true,
      attrs: { url: { default: "" } },
    },
    mermaid: {
      group: "block",
      atom: true,
      attrs: { code: { default: "" } },
    },
  },
});

describe("commentQuoteLabel", () => {
  it("labels pure leaf quotes", () => {
    expect(commentQuoteLabel(LEAF_PLACEHOLDER)).toBe("Embedded block");
    expect(commentQuoteLabel(LEAF_PLACEHOLDER + LEAF_PLACEHOLDER)).toBe(
      "Embedded blocks",
    );
  });

  it("shows box for mixed text+leaf", () => {
    expect(commentQuoteLabel(`hi${LEAF_PLACEHOLDER}lo`)).toBe("hi▢lo");
  });
});

describe("leafIdentity", () => {
  it("keys images by url", () => {
    const img = schema.nodes.image.create({ url: ".assets/a.png" });
    expect(leafIdentity(img)).toEqual({
      type: "image",
      key: ".assets/a.png",
    });
  });

  it("hashes mermaid code", () => {
    const a = schema.nodes.mermaid.create({ code: "A-->B" });
    const b = schema.nodes.mermaid.create({ code: "A-->B" });
    const c = schema.nodes.mermaid.create({ code: "X" });
    expect(leafIdentity(a)?.key).toBe(leafIdentity(b)?.key);
    expect(leafIdentity(a)?.key).not.toBe(leafIdentity(c)?.key);
  });
});

describe("doc with image is a leaf node", () => {
  it("builds a minimal doc", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello")]),
      schema.nodes.image.create({ url: "x.png" }),
    ]);
    expect(doc.childCount).toBe(2);
    expect((doc.child(1) as Node).type.name).toBe("image");
  });
});
