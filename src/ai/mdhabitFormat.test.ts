import { describe, expect, it } from "vitest";
import { MDHABIT_FORMAT_GUIDE, mdhabitCoreRules } from "./mdhabitFormat";

describe("mdhabitFormat guide", () => {
  it("exposes core rules", () => {
    const rules = mdhabitCoreRules();
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.some((r) => r.includes(".mdhabit"))).toBe(true);
    expect(MDHABIT_FORMAT_GUIDE).toContain("# MarkSpace habits v1");
  });
});
