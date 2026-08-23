/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { htmlToDocxBytes } from "./htmlToDocx";
import { wrapNoteHtmlForDocx } from "./saveNoteDocx";

describe("htmlToDocxBytes", () => {
  it("builds a docx zip from headings, bold, lists and a table", async () => {
    const html = wrapNoteHtmlForDocx(
      "<h1>Title</h1><p><strong>bold</strong> and <em>em</em></p><ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol><table><tr><th>Q</th><td>1</td></tr></table>",
    );
    const bytes = await htmlToDocxBytes(html);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe(
      "PK\u0003\u0004",
    );
  });
});
