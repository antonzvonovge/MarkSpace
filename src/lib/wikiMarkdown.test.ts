import { describe, expect, it } from "vitest";
import {
  markdownToWiki,
  wikiToMarkdown,
  wikiTargetFromHref,
  extractWikiLinkTargets,
  healFakeHttpsVaultLinks,
} from "./wikiMarkdown";

describe("healFakeHttpsVaultLinks", () => {
  it("unwraps nested [file.md](https://file.md) inside wiki brackets", () => {
    expect(
      healFakeHttpsVaultLinks(
        "[[English/IELTS/[Speaking.md](https://Speaking.md)|Speaking Overview]]",
      ),
    ).toBe("[[English/IELTS/Speaking.md|Speaking Overview]]");

    expect(
      healFakeHttpsVaultLinks(
        "[[English/IELTS/Writing/Task 2/[25.08.2026.md](https://25.08.2026.md)]]",
      ),
    ).toBe("[[English/IELTS/Writing/Task 2/25.08.2026.md]]");
  });

  it("converts standalone fake https vault links to wiki-links", () => {
    expect(healFakeHttpsVaultLinks("[Speaking.md](https://Speaking.md)")).toBe(
      "[[Speaking.md]]",
    );
    expect(
      healFakeHttpsVaultLinks("[Speaking Overview](https://Speaking.md)"),
    ).toBe("[[Speaking.md|Speaking Overview]]");
  });

  it("leaves real website .md URLs alone", () => {
    const src = "[docs](https://example.com/guide.md)";
    expect(healFakeHttpsVaultLinks(src)).toBe(src);
  });

  it("is applied by wikiToMarkdown before conversion", () => {
    const mid = wikiToMarkdown(
      "See [[folder/[Note.md](https://Note.md)|Alias]]",
    );
    expect(mid).toBe("See [Alias](wiki:folder%2FNote.md)");
  });
});

describe("wikiToMarkdown / markdownToWiki", () => {
  it("round-trips a simple wiki link", () => {
    const src = "See [[Welcome]] please";
    const mid = wikiToMarkdown(src);
    expect(mid).toBe("See [Welcome](wiki:Welcome) please");
    expect(markdownToWiki(mid)).toBe(src);
  });

  it("round-trips an aliased wiki link", () => {
    const src = "See [[folder/note|Alias]]";
    const mid = wikiToMarkdown(src);
    expect(mid).toBe("See [Alias](wiki:folder%2Fnote)");
    expect(markdownToWiki(mid)).toBe(src);
  });

  it("keeps a literal # in the vault path (folder names like #5 …)", () => {
    const path =
      "Клуб Синдикат ИИ/Встречи клуба/#5 Agentic Loops/План презентации - Agentic Loops.md";
    const src = `См. [[${path}|План презентации - Agentic Loops]]`;
    const mid = wikiToMarkdown(src);
    expect(mid).toContain("](wiki:");
    expect(mid).toContain(encodeURIComponent(path));
    expect(mid).toContain("[План презентации - Agentic Loops]");
    expect(markdownToWiki(mid)).toBe(src);
    expect(wikiTargetFromHref(`wiki:${encodeURIComponent(path)}`)).toBe(path);
  });

  it("round-trips audio embeds", () => {
    const src = "![[listening.wav]]";
    const mid = wikiToMarkdown(src);
    expect(mid).toBe("```audio\nlistening.wav\n```");
    expect(markdownToWiki(mid)).toBe(src);
  });

  it("round-trips drawio embeds whose path contains #", () => {
    const src = "![[meetings/#5 loop/diagram.drawio|480]]";
    const mid = wikiToMarkdown(src);
    expect(mid).toBe("```drawio\nmeetings/#5 loop/diagram.drawio|480\n```");
    expect(markdownToWiki(mid)).toBe(src);
  });

  it("extracts wiki targets and skips code and drawio embeds", () => {
    const src = [
      "See [[Welcome]] and [[folder/note|Alias]].",
      "```",
      "[[inside-fence]]",
      "```",
      "`[[inline]]`",
      "![[diagram.drawio]]",
    ].join("\n");
    expect(extractWikiLinkTargets(src)).toEqual(["Welcome", "folder/note"]);
  });
});
