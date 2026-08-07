import { describe, expect, it } from "vitest";
import {
  markdownToWiki,
  wikiToMarkdown,
  wikiTargetFromHref,
} from "./wikiMarkdown";

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

  it("round-trips drawio embeds whose path contains #", () => {
    const src = "![[meetings/#5 loop/diagram.drawio|480]]";
    const mid = wikiToMarkdown(src);
    expect(mid).toBe("```drawio\nmeetings/#5 loop/diagram.drawio|480\n```");
    expect(markdownToWiki(mid)).toBe(src);
  });
});
