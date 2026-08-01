import { describe, expect, it } from "vitest";
import { MDLNKS_FORMAT_GUIDE, mdlnksCoreRules } from "./mdlnksFormat";

describe("mdlnksFormat guide", () => {
  it("exposes core rules", () => {
    const rules = mdlnksCoreRules();
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.some((r) => r.includes(".mdlnks"))).toBe(true);
    expect(MDLNKS_FORMAT_GUIDE).toContain("# MarkSpace links v1");
  });
});
