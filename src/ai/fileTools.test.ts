import { describe, expect, it } from "vitest";
import { _test } from "./fileTools";

describe("fileTools helpers", () => {
  it("detects http(s) URLs", () => {
    expect(_test.isHttpUrl("https://example.com/a.png")).toBe(true);
    expect(_test.isHttpUrl("http://example.com/a.png")).toBe(true);
    expect(_test.isHttpUrl("Notes/.assets/a.png")).toBe(false);
    expect(_test.isHttpUrl("ftp://x")).toBe(false);
  });

  it("extracts filename from URL", () => {
    expect(_test.filenameFromUrl("https://cdn.example.com/img/logo.png")).toBe(
      "logo.png",
    );
    expect(
      _test.filenameFromUrl("https://cdn.example.com/img/logo.png?w=2"),
    ).toBe("logo.png");
  });

  it("resolves save_as directory vs file path", () => {
    expect(_test.resolveSavePath("Project/.assets/", "logo.png")).toBe(
      "Project/.assets/logo.png",
    );
    expect(_test.resolveSavePath("Project/.assets/logo.png", "x.png")).toBe(
      "Project/.assets/logo.png",
    );
  });

  it("sniffs image magic bytes", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
    ]);
    expect(_test.sniffMediaType(png)).toBe("image/png");
    expect(_test.mediaTypeFromExt("webp")).toBe("image/webp");
  });
});
