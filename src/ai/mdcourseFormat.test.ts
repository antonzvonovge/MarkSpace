import { describe, expect, it } from "vitest";
import { MDCOURSE_FORMAT_GUIDE, mdcourseCoreRules } from "./mdcourseFormat";

describe("mdcourseFormat guide", () => {
  it("extracts core rules mentioning .mdcourse", () => {
    const rules = mdcourseCoreRules();
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.some((r) => r.includes(".mdcourse"))).toBe(true);
    expect(MDCOURSE_FORMAT_GUIDE).toContain("# MarkSpace course v1");
  });
});
