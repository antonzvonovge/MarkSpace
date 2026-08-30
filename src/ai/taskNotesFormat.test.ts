import { describe, expect, it } from "vitest";
import {
  TASK_NOTES_FORMAT_GUIDE,
  taskNotesCoreRules,
} from "./taskNotesFormat";

describe("taskNotesFormat", () => {
  it("exposes the task notes guide and core rules", () => {
    expect(TASK_NOTES_FORMAT_GUIDE).toContain("# MarkSpace task notes");
    const rules = taskNotesCoreRules();
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.some((r) => /Tasks\//.test(r))).toBe(true);
    expect(rules.some((r) => /kind=`tasks`|kind=tasks/.test(r))).toBe(true);
  });
});
