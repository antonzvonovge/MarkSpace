import { describe, expect, it } from "vitest";
import {
  buildClipMarkdown,
  extractArticleTitle,
  extractImageUrls,
  filenameFromImageUrl,
  resolveClipNotePath,
  rewriteImageUrls,
  slugifyTitle,
  stripReaderChrome,
} from "./clipArticle";

describe("clipArticle helpers", () => {
  it("strips Jina reader chrome", () => {
    const raw = [
      "Title: Example Domain",
      "",
      "URL Source: https://example.com/",
      "",
      "Markdown Content:",
      "# Example Domain",
      "",
      "Hello",
    ].join("\n");
    expect(stripReaderChrome(raw)).toBe("# Example Domain\n\nHello");
  });

  it("extracts title from Title line, H1, or URL", () => {
    expect(
      extractArticleTitle("Title: Hello World\n\nbody", "https://x.com"),
    ).toBe("Hello World");
    expect(
      extractArticleTitle("# From Heading\n\nbody", "https://x.com/a"),
    ).toBe("From Heading");
    expect(
      extractArticleTitle("no title", "https://example.com/my-post/"),
    ).toBe("my post");
    expect(
      extractArticleTitle("body", "https://x.com", "Override"),
    ).toBe("Override");
  });

  it("slugifies titles including unicode", () => {
    expect(slugifyTitle("Hello World!")).toBe("Hello-World");
    expect(slugifyTitle("Статья про AI")).toBe("Статья-про-AI");
  });

  it("resolves note paths under folder / Clippings / project", () => {
    expect(
      resolveClipNotePath({ title: "Hello World" }),
    ).toBe("Clippings/Hello-World.md");
    expect(
      resolveClipNotePath({
        title: "Hello",
        folder: "Research/Inbox",
      }),
    ).toBe("Research/Inbox/Hello.md");
    expect(
      resolveClipNotePath({
        title: "Hello",
        defaultFolder: "MyProject",
      }),
    ).toBe("MyProject/Clippings/Hello.md");
    expect(
      resolveClipNotePath({
        title: "Hello",
        folder: "Research",
        path: "Inbox/Saved",
      }),
    ).toBe("Inbox/Saved.md");
  });

  it("extracts unique http image URLs from markdown and HTML", () => {
    const md = [
      "![a](https://cdn.example.com/a.png)",
      "![b|320](https://cdn.example.com/b.jpg)",
      "![again](https://cdn.example.com/a.png)",
      '<img src="https://cdn.example.com/c.webp" alt="c">',
      "![local](.assets/x.png)",
      "![data](data:image/png;base64,xxx)",
    ].join("\n");
    expect(extractImageUrls(md)).toEqual([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.jpg",
      "https://cdn.example.com/c.webp",
    ]);
  });

  it("rewrites remote URLs to local .assets paths", () => {
    const md = "![a](https://cdn.example.com/a.png)\n\n![b](https://cdn.example.com/b.jpg)";
    const mapping = new Map([
      ["https://cdn.example.com/a.png", ".assets/a.png"],
      ["https://cdn.example.com/b.jpg", ".assets/b.jpg"],
    ]);
    expect(rewriteImageUrls(md, mapping)).toBe(
      "![a](.assets/a.png)\n\n![b](.assets/b.jpg)",
    );
  });

  it("builds clip markdown with source line and without duplicate H1", () => {
    const out = buildClipMarkdown({
      title: "Example",
      sourceUrl: "https://example.com/",
      body: "# Example\n\nBody text",
    });
    expect(out).toBe(
      "# Example\n\nSource: https://example.com/\n\nBody text\n",
    );
  });

  it("derives image filenames from URLs", () => {
    expect(filenameFromImageUrl("https://cdn.example.com/img/logo.png?w=2", 0)).toBe(
      "logo.png",
    );
    expect(filenameFromImageUrl("https://cdn.example.com/img/photo", 3)).toBe(
      "photo.img",
    );
  });
});
