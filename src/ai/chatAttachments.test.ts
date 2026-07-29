import { describe, expect, it } from "vitest";
import {
  attachedDocNamesFromUserMessage,
  classifyAttachment,
  displayTextFromUserMessage,
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

  it("hides nested-fence attachment dumps from the chat bubble", () => {
    const noteBody = [
      "# Title",
      "",
      "Intro",
      "```js",
      "console.log(1)",
      "```",
      "",
      "More text after fence",
    ].join("\n");
    const { parts } = prepareUserMessageParts("Summarize this", [
      {
        id: "2",
        name: "note.md",
        mediaType: "text/markdown",
        size: noteBody.length,
        kind: "text",
        textContent: noteBody,
      },
    ]);
    const message = { id: "u1", role: "user" as const, parts };
    expect(displayTextFromUserMessage(message)).toBe("Summarize this");
    expect(attachedDocNamesFromUserMessage(message)).toEqual(["note.md"]);
    // Model payload still has the full note.
    const textPart = parts.find((p) => p.type === "text");
    expect(textPart && textPart.type === "text" && textPart.text).toContain(
      "More text after fence",
    );
  });

  it("shows only a chip when the message is attachment-only", () => {
    const { parts } = prepareUserMessageParts("", [
      {
        id: "2",
        name: "solo.md",
        mediaType: "text/markdown",
        size: 4,
        kind: "text",
        textContent: "body",
      },
    ]);
    const message = { id: "u2", role: "user" as const, parts };
    expect(displayTextFromUserMessage(message)).toBe("");
    expect(attachedDocNamesFromUserMessage(message)).toEqual(["solo.md"]);
  });
});
