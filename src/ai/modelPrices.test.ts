import { describe, expect, it } from "vitest";
import {
  formatPerMillionAmount,
  formatPerMillionPair,
  formatPerMillionTitle,
  lookupModelPrice,
  modelPriceLookupKeys,
  parseLiteLlmPriceMap,
  perTokenToPerMillion,
} from "./modelPrices";

describe("perTokenToPerMillion", () => {
  it("scales LiteLLM per-token costs", () => {
    expect(perTokenToPerMillion(4e-6)).toBe(4);
    expect(perTokenToPerMillion(4e-7)).toBeCloseTo(0.4);
    expect(perTokenToPerMillion(2e-5)).toBe(20);
  });
});

describe("parseLiteLlmPriceMap", () => {
  it("extracts input/output $/1M and skips sample_spec", () => {
    const map = parseLiteLlmPriceMap({
      sample_spec: {
        input_cost_per_token: 1,
        output_cost_per_token: 2,
      },
      "gpt-5.6-sol": {
        input_cost_per_token: 4e-6,
        output_cost_per_token: 2e-5,
        litellm_provider: "openai",
      },
      broken: { input_cost_per_token: 1e-6 },
    });
    expect(map).toEqual({
      "gpt-5.6-sol": { inPerM: 4, outPerM: 20 },
    });
  });

  it("returns empty for invalid root", () => {
    expect(parseLiteLlmPriceMap(null)).toEqual({});
    expect(parseLiteLlmPriceMap([])).toEqual({});
  });
});

describe("modelPriceLookupKeys / lookupModelPrice", () => {
  const prices = parseLiteLlmPriceMap({
    "gpt-5.6-sol": {
      input_cost_per_token: 4e-6,
      output_cost_per_token: 2e-5,
    },
    "gpt-4.1-mini": {
      input_cost_per_token: 4e-7,
      output_cost_per_token: 1.6e-6,
    },
    "gemini-3.7-flash": {
      input_cost_per_token: 7.5e-7,
      output_cost_per_token: 3.75e-6,
    },
    "openai/custom-only": {
      input_cost_per_token: 1e-6,
      output_cost_per_token: 2e-6,
    },
  });

  it("prefers bare name for catalog ids", () => {
    expect(modelPriceLookupKeys("openai/gpt-5.6-sol")).toEqual([
      "openai/gpt-5.6-sol",
      "gpt-5.6-sol",
      "google/gpt-5.6-sol",
      "gemini/gpt-5.6-sol",
    ]);
    expect(lookupModelPrice("openai/gpt-5.6-sol", prices)).toEqual({
      inPerM: 4,
      outPerM: 20,
    });
    expect(lookupModelPrice("openai/gpt-4.1-mini", prices)?.inPerM).toBeCloseTo(
      0.4,
    );
    expect(lookupModelPrice("google/gemini-3.7-flash", prices)?.outPerM).toBeCloseTo(
      3.75,
    );
  });

  it("hits prefixed keys when bare is missing", () => {
    expect(lookupModelPrice("openai/custom-only", prices)).toEqual({
      inPerM: 1,
      outPerM: 2,
    });
  });

  it("returns null when unknown", () => {
    expect(lookupModelPrice("openai/nope", prices)).toBeNull();
    expect(lookupModelPrice("openai/gpt-5.6-sol", {})).toBeNull();
    expect(lookupModelPrice("openai/gpt-5.6-sol", null)).toBeNull();
  });
});

describe("formatPerMillion*", () => {
  it("formats compact amounts", () => {
    expect(formatPerMillionAmount(20)).toBe("20");
    expect(formatPerMillionAmount(4)).toBe("4");
    expect(formatPerMillionAmount(1.6)).toBe("1.6");
    expect(formatPerMillionAmount(0.4)).toBe("0.4");
    expect(formatPerMillionAmount(0.75)).toBe("0.75");
  });

  it("formats pair and title", () => {
    const price = { inPerM: 4, outPerM: 20 };
    expect(formatPerMillionPair(price)).toBe("$4/$20");
    expect(formatPerMillionTitle(price)).toBe(
      "≈ $4 / $20 per 1M tokens (LiteLLM estimate)",
    );
    expect(formatPerMillionPair({ inPerM: 0.4, outPerM: 1.6 })).toBe(
      "$0.4/$1.6",
    );
  });
});
