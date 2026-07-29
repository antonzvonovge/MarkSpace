import { describe, expect, it } from "vitest";
import {
  classifyAttachment,
  prepareUserMessageParts,
  type ChatAttachment,
} from "./chatAttachments";

describe("chatAttachments", () => {
  it("classifies images, pdfs, and text by mime/extension", () => {
    expect(classifyAttachment("a.png", "image/png")).toBe("image");
    expect(classifyAttachment("doc.pdf", "application/pdf")).toBe("pdf");
    expect(classifyAttachment("note.md", "")).toBe("text");
    expect(classifyAttachment("bin.exe", "application/octet-stream")).toBe(
      "unsupported",
    );
  });

  it("builds multimodal parts for images and text docs", () => {
    const attachments: ChatAttachment[] = [
      {
        id: "1",
        name: "shot.png",
        mediaType: "image/png",
        size: 10,
        kind: "image",
        dataUrl: "data:image/png;base64,aaa",
      },
      {
        id: "2",
        name: "notes.md",
        mediaType: "text/markdown",
        size: 20,
        kind: "text",
        textContent: "hello vault",
      },
    ];
    const { parts, titleHint } = prepareUserMessageParts("Look", attachments);
    expect(titleHint).toBe("Look");
    expect(parts.some((p) => p.type === "text" && p.text.includes("hello vault")))
      .toBe(true);
    expect(
      parts.some(
        (p) =>
          p.type === "file" &&
          p.filename === "shot.png" &&
          p.url.startsWith("data:image/png"),
      ),
    ).toBe(true);
  });

  it("allows image-only send with placeholder text", () => {
    const { parts } = prepareUserMessageParts("", [
      {
        id: "1",
        name: "a.jpg",
        mediaType: "image/jpeg",
        size: 1,
        kind: "image",
        dataUrl: "data:image/jpeg;base64,bb",
      },
    ]);
    expect(parts.some((p) => p.type === "text")).toBe(true);
    expect(parts.some((p) => p.type === "file")).toBe(true);
  });
});
