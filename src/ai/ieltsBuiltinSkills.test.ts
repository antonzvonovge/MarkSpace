import { describe, expect, it } from "vitest";
import {
  listBuiltinIeltsSkills,
  loadBuiltinIeltsSkill,
} from "./ieltsBuiltinSkills";

describe("ieltsBuiltinSkills", () => {
  it("ships four GT practice skills", () => {
    const ids = listBuiltinIeltsSkills().map((s) => s.id).sort();
    expect(ids).toEqual([
      "ielts-listening",
      "ielts-reading",
      "ielts-speaking",
      "ielts-writing",
    ]);
    for (const id of ids) {
      const loaded = loadBuiltinIeltsSkill(id);
      expect(loaded?.meta.description.length).toBeGreaterThan(20);
      expect(loaded?.body).toContain("ielts_practice");
      expect(loaded?.body).toContain("pick_vault_folder");
      expect(loaded?.body).toContain("existing_topics");
    }
    const listening = loadBuiltinIeltsSkill("ielts-listening");
    expect(listening?.body).toContain("After end: stop");
    expect(listening?.body).not.toContain("exam vs practice");
    expect(listening?.body).not.toContain("exam_mode");
    expect(listening?.body).toContain("show_paper");
    expect(loadBuiltinIeltsSkill("ielts-writing")?.body).toContain("show_paper");
    expect(loadBuiltinIeltsSkill("ielts-reading")?.body).toContain("show_paper");
    expect(loadBuiltinIeltsSkill("ielts-speaking")?.body).toContain("show_paper");
  });
});
