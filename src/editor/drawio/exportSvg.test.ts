import { describe, expect, it } from "vitest";
import { normalizeExportedSvg } from "./exportSvg";

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const CYRILLIC_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><text>Новый шаг цикла</text></svg>';

describe("normalizeExportedSvg", () => {
  it("decodes UTF-8 Cyrillic from a base64 SVG data URI", () => {
    const uri = `data:image/svg+xml;base64,${utf8ToBase64(CYRILLIC_SVG)}`;
    // Latin-1 atob is the live-preview mojibake (Ð/Ñ instead of Cyrillic).
    expect(atob(uri.split(",")[1]!)).not.toContain("Новый");
    expect(normalizeExportedSvg(uri)).toContain("Новый шаг цикла");
  });

  it("decodes percent-encoded SVG data URIs", () => {
    const uri = `data:image/svg+xml,${encodeURIComponent(CYRILLIC_SVG)}`;
    expect(normalizeExportedSvg(uri)).toContain("Новый шаг цикла");
  });

  it("passes through already-decoded SVG markup", () => {
    expect(normalizeExportedSvg(CYRILLIC_SVG)).toContain("Новый шаг цикла");
  });
});
