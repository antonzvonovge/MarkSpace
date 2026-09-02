import { describe, expect, it } from "vitest";
import {
  extractStepCostUsd,
  formatChatCostUsd,
  parseUsdCost,
  sumStepCostsUsd,
} from "./llmCost";

describe("parseUsdCost", () => {
  it("parses numbers and numeric strings", () => {
    expect(parseUsdCost(0.000214)).toBe(0.000214);
    expect(parseUsdCost("0.0008778")).toBe(0.0008778);
    expect(parseUsdCost("bad")).toBeNull();
  });
});

describe("extractStepCostUsd", () => {
  it("reads LiteLLM response headers first", () => {
    expect(
      extractStepCostUsd({
        response: {
          headers: { "x-litellm-response-cost": "0.000415" },
        },
        usage: { raw: { cost: 0.99 } },
      } as never),
    ).toBe(0.000415);
  });

  it("reads usage.cost from the raw provider payload", () => {
    expect(
      extractStepCostUsd({
        response: {},
        usage: { raw: { cost: 0.0008778, prompt_tokens: 26 } },
      } as never),
    ).toBe(0.0008778);
  });

  it("sums only reported step costs", () => {
    expect(
      sumStepCostsUsd([
        {
          response: { headers: { "x-litellm-response-cost": "0.01" } },
        },
        { response: {} },
        {
          usage: { raw: { cost: 0.02 } },
        },
      ] as never),
    ).toBe(0.03);
  });
});

describe("formatChatCostUsd", () => {
  it("formats with four decimals and a dollar sign", () => {
    expect(formatChatCostUsd(0.0532)).toBe("0.0532 $");
  });
});
