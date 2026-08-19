import { describe, expect, it } from "vitest";
import { filePathFromAssetSrc, vaultRelFromAbsolute } from "./assetUrl";

describe("filePathFromAssetSrc", () => {
  it("decodes Linux convertFileSrc URLs", () => {
    const abs = "/home/user/vault/note/.assets/pic.png";
    const src = `asset://localhost/${encodeURIComponent(abs)}`;
    expect(filePathFromAssetSrc(src)).toBe(abs);
  });

  it("decodes Windows convertFileSrc URLs", () => {
    const abs = "C:\\Users\\me\\vault\\pic.png";
    const src = `http://asset.localhost/${encodeURIComponent(abs)}`;
    expect(filePathFromAssetSrc(src)).toBe(abs);
  });

  it("accepts a decoded Unix path with an extra slash", () => {
    expect(filePathFromAssetSrc("asset://localhost//home/user/pic.png")).toBe(
      "/home/user/pic.png",
    );
  });

  it("returns null for http(s) and blob URLs", () => {
    expect(filePathFromAssetSrc("https://example.com/a.png")).toBeNull();
    expect(filePathFromAssetSrc("blob:http://localhost:1420/abc")).toBeNull();
  });
});

describe("vaultRelFromAbsolute", () => {
  it("strips the Unix vault root", () => {
    expect(
      vaultRelFromAbsolute(
        "/home/user/vault/Lang/.assets/a.png",
        "/home/user/vault",
      ),
    ).toBe("Lang/.assets/a.png");
  });

  it("strips a Windows vault root case-insensitively", () => {
    expect(
      vaultRelFromAbsolute(
        "C:\\Users\\me\\Vault\\Note\\.assets\\a.png",
        "c:/Users/me/Vault",
      ),
    ).toBe("Note/.assets/a.png");
  });

  it("returns null when the file is outside the vault", () => {
    expect(
      vaultRelFromAbsolute("/tmp/other.png", "/home/user/vault"),
    ).toBeNull();
  });
});
