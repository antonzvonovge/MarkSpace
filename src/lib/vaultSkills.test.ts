import { describe, expect, it } from "vitest";
import {
  SKILLS_FOLDER,
  isSkillsFolder,
  isValidSkillId,
  isVaultProjectFolder,
  skillIdFromPath,
  skillPathForId,
} from "./vaultApi";

describe("vault skills helpers", () => {
  it("identifies the Skills folder and excludes it from projects", () => {
    expect(isSkillsFolder(SKILLS_FOLDER)).toBe(true);
    expect(isSkillsFolder("Skills", false)).toBe(false);
    expect(isSkillsFolder("Other")).toBe(false);
    expect(isVaultProjectFolder("Skills", true)).toBe(false);
    expect(isVaultProjectFolder("Incoming", true)).toBe(false);
    expect(isVaultProjectFolder("Work", true)).toBe(true);
  });

  it("validates skill ids and paths", () => {
    expect(isValidSkillId("meeting-notes")).toBe(true);
    expect(isValidSkillId("a")).toBe(true);
    expect(isValidSkillId("Bad_Id")).toBe(false);
    expect(isValidSkillId("spaces here")).toBe(false);
    expect(skillIdFromPath("Skills/meeting-notes.md")).toBe("meeting-notes");
    expect(skillIdFromPath("Skills/nested/x.md")).toBe(null);
    expect(skillPathForId("meeting-notes")).toBe("Skills/meeting-notes.md");
  });
});
