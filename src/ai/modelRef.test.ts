import { describe, expect, it } from "vitest";
import {
  createProviderId,
  formatModelRef,
  isProviderId,
  parseModelRef,
} from "./modelRef";

describe("parseModelRef", () => {
  it("treats bare catalog ids as auto", () => {
    expect(parseModelRef("openai/gpt-5")).toEqual({
      modelId: "openai/gpt-5",
      providerId: null,
    });
    expect(parseModelRef("google/gemini-3.8-flash")).toEqual({
      modelId: "google/gemini-3.8-flash",
      providerId: null,
    });
  });

  it("splits a bound provider suffix", () => {
    expect(parseModelRef("openai/gpt-5@prv_x7k2")).toEqual({
      modelId: "openai/gpt-5",
      providerId: "prv_x7k2",
    });
  });

  it("ignores @ that is not a provider id", () => {
    expect(parseModelRef("user@host/model")).toEqual({
      modelId: "user@host/model",
      providerId: null,
    });
  });

  it("trims whitespace", () => {
    expect(parseModelRef("  openai/gpt-5@prv_abc  ")).toEqual({
      modelId: "openai/gpt-5",
      providerId: "prv_abc",
    });
  });
});

describe("formatModelRef", () => {
  it("omits @ for auto", () => {
    expect(formatModelRef("openai/gpt-5", null)).toBe("openai/gpt-5");
    expect(formatModelRef("openai/gpt-5", undefined)).toBe("openai/gpt-5");
    expect(formatModelRef("openai/gpt-5", "")).toBe("openai/gpt-5");
  });

  it("appends a valid provider id", () => {
    expect(formatModelRef("openai/gpt-5", "prv_x7k2")).toBe(
      "openai/gpt-5@prv_x7k2",
    );
  });

  it("round-trips with parseModelRef", () => {
    const ref = formatModelRef("google/gemini-flash", "prv_abc123");
    expect(parseModelRef(ref)).toEqual({
      modelId: "google/gemini-flash",
      providerId: "prv_abc123",
    });
  });
});

describe("isProviderId / createProviderId", () => {
  it("validates provider ids", () => {
    expect(isProviderId("prv_x7k2")).toBe(true);
    expect(isProviderId("prv_")).toBe(false);
    expect(isProviderId("x7k2")).toBe(false);
  });

  it("creates ids that parse", () => {
    const id = createProviderId();
    expect(isProviderId(id)).toBe(true);
  });
});
