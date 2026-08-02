import { describe, expect, it } from "vitest";
import { MDDICT_FORMAT_GUIDE, mddictCoreRules } from "./mddictFormat";

describe("mddictFormat guide", () => {
  it("exposes core rules from the guide", () => {
    const rules = mddictCoreRules();
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.some((r) => r.includes(".mddict"))).toBe(true);
    expect(MDDICT_FORMAT_GUIDE).toContain("# MarkSpace dictionary v1");
  });
});
