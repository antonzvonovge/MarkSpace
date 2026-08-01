import { describe, expect, it } from "vitest";
import {
  formatForcedSkillsLines,
  formatSkillsCatalogLines,
  isCatalogSkill,
  parseSkillMeta,
  skillTemplate,
  type LoadedSkill,
  type SkillMeta,
} from "./skills";

describe("skills", () => {
  it("builds a template with frontmatter", () => {
    const md = skillTemplate("meeting-notes");
    expect(md).toContain("description:");
    expect(md).toContain("disable-model-invocation: false");
    expect(md).toContain("# meeting-notes");
  });

  it("parses skill meta from frontmatter", () => {
    const md = `---
description: Creates meeting notes. Use when summarizing meetings.
disable-model-invocation: true
---

# Body
`;
    const meta = parseSkillMeta("meeting-notes", "Skills/meeting-notes.md", md);
    expect(meta).toEqual({
      id: "meeting-notes",
      path: "Skills/meeting-notes.md",
      description: "Creates meeting notes. Use when summarizing meetings.",
      disableModelInvocation: true,
    });
    expect(isCatalogSkill(meta)).toBe(false);
  });

  it("treats missing description / disable as catalog rules", () => {
    const noDesc = parseSkillMeta("x", "Skills/x.md", "---\n---\n\nHi\n");
    expect(noDesc.description).toBe("");
    expect(isCatalogSkill(noDesc)).toBe(false);

    const ok: SkillMeta = {
      id: "ok-skill",
      path: "Skills/ok-skill.md",
      description: "Does a thing. Use when asked.",
      disableModelInvocation: false,
    };
    expect(isCatalogSkill(ok)).toBe(true);
  });

  it("formats catalog and forced skill lines", () => {
    const skills: SkillMeta[] = [
      {
        id: "a",
        path: "Skills/a.md",
        description: "Alpha skill.",
        disableModelInvocation: false,
      },
      {
        id: "b",
        path: "Skills/b.md",
        description: "Hidden.",
        disableModelInvocation: true,
      },
    ];
    const catalog = formatSkillsCatalogLines(skills);
    expect(catalog[0]).toMatch(/Available skills/);
    expect(catalog.some((l) => l.includes("a: Alpha"))).toBe(true);
    expect(catalog.some((l) => l.includes("b:"))).toBe(false);

    const loaded: LoadedSkill[] = [
      {
        meta: skills[0]!,
        body: "Do the alpha thing.",
        raw: "",
      },
    ];
    const forced = formatForcedSkillsLines(loaded);
    expect(forced.join("\n")).toContain("User requested skill");
    expect(forced.join("\n")).toContain("Do the alpha thing.");
  });
});
