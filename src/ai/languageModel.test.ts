import { describe, expect, it } from "vitest";
import {
  credentialsFromSettings,
  hasAnyLlmCredentials,
  hasCredentialsForModel,
  missingCredentialsMessage,
  pickWorkerModelId,
  planModelRoute,
  runWithModelFallback,
  stripVendorPrefix,
  toDirectProviderModelId,
  vendorFromModelId,
  type AiProviderCredentials,
} from "./languageModel";
import { DEFAULT_AI_SETTINGS } from "./types";

const emptyKeys: AiProviderCredentials = {
  openrouterApiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  googleApiKey: "",
};

describe("vendor / id helpers", () => {
  it("detects vendor from catalog id", () => {
    expect(vendorFromModelId("anthropic/claude-sonnet-4.6")).toBe("anthropic");
    expect(vendorFromModelId("google/gemini-2.5-pro")).toBe("google");
    expect(vendorFromModelId("openai/gpt-4.1")).toBe("openai");
    expect(vendorFromModelId("gpt-4.1")).toBe("openai");
  });

  it("strips vendor prefix", () => {
    expect(stripVendorPrefix("anthropic/claude-sonnet-4.6")).toBe(
      "claude-sonnet-4.6",
    );
    expect(stripVendorPrefix("gpt-4.1")).toBe("gpt-4.1");
  });

  it("maps Anthropic catalog ids to native hyphenated ids", () => {
    expect(
      toDirectProviderModelId("anthropic", "anthropic/claude-sonnet-4.6"),
    ).toBe("claude-sonnet-4-6");
    expect(
      toDirectProviderModelId("anthropic", "anthropic/claude-opus-4.8"),
    ).toBe("claude-opus-4-8");
    expect(toDirectProviderModelId("openai", "openai/gpt-4.1-mini")).toBe(
      "gpt-4.1-mini",
    );
    expect(
      toDirectProviderModelId("google", "google/gemini-3.1-pro-preview"),
    ).toBe("gemini-3.1-pro-preview");
  });
});

describe("planModelRoute", () => {
  it("prefers direct provider key over OpenRouter", () => {
    const plan = planModelRoute("anthropic/claude-sonnet-4.6", {
      ...emptyKeys,
      anthropicApiKey: "sk-ant-test",
      openrouterApiKey: "sk-or-test",
    });
    expect(plan).toEqual({
      transport: "direct",
      vendor: "anthropic",
      catalogModelId: "anthropic/claude-sonnet-4.6",
      providerModelId: "claude-sonnet-4-6",
    });
  });

  it("falls back to OpenRouter when provider key is missing", () => {
    const plan = planModelRoute("google/gemini-2.5-flash", {
      ...emptyKeys,
      openrouterApiKey: "sk-or-test",
    });
    expect(plan).toEqual({
      transport: "openrouter",
      vendor: "google",
      catalogModelId: "google/gemini-2.5-flash",
      providerModelId: "google/gemini-2.5-flash",
    });
  });

  it("routes OpenAI models directly when openai key is set", () => {
    const plan = planModelRoute("openai/gpt-4.1-mini", {
      ...emptyKeys,
      openaiApiKey: "sk-test",
    });
    expect(plan.transport).toBe("direct");
    expect(plan.providerModelId).toBe("gpt-4.1-mini");
  });

  it("throws a clear error when no suitable key exists", () => {
    expect(() =>
      planModelRoute("anthropic/claude-sonnet-4.6", emptyKeys),
    ).toThrow(/Anthropic or OpenRouter/);
  });

  it("does not use a wrong-vendor direct key", () => {
    const plan = planModelRoute("anthropic/claude-sonnet-4.6", {
      ...emptyKeys,
      openaiApiKey: "sk-openai",
      openrouterApiKey: "sk-or",
    });
    expect(plan.transport).toBe("openrouter");
  });
});

describe("credential helpers", () => {
  it("reads keys from settings", () => {
    const keys = credentialsFromSettings({
      ...DEFAULT_AI_SETTINGS,
      apiKey: "  or-key  ",
      openaiApiKey: "oa",
      anthropicApiKey: "",
      googleApiKey: " g ",
    });
    expect(keys).toEqual({
      openrouterApiKey: "or-key",
      openaiApiKey: "oa",
      anthropicApiKey: "",
      googleApiKey: "g",
    });
  });

  it("detects any LLM credentials", () => {
    expect(hasAnyLlmCredentials(DEFAULT_AI_SETTINGS)).toBe(false);
    expect(
      hasAnyLlmCredentials({ ...DEFAULT_AI_SETTINGS, googleApiKey: "x" }),
    ).toBe(true);
    expect(
      hasAnyLlmCredentials({ ...DEFAULT_AI_SETTINGS, apiKey: "or" }),
    ).toBe(true);
  });

  it("checks credentials for a specific model", () => {
    const openaiOnly = {
      ...emptyKeys,
      openaiApiKey: "sk",
    };
    expect(hasCredentialsForModel("openai/gpt-4.1", openaiOnly)).toBe(true);
    expect(
      hasCredentialsForModel("anthropic/claude-sonnet-4.6", openaiOnly),
    ).toBe(false);
    expect(
      missingCredentialsMessage("anthropic/claude-sonnet-4.6", openaiOnly),
    ).toMatch(/Anthropic or OpenRouter/);
  });

  it("picks the worker model when credentials exist, else chat fallback", () => {
    const openaiOnly = { ...emptyKeys, openaiApiKey: "sk" };
    expect(
      pickWorkerModelId({
        keys: openaiOnly,
        modelId: "openai/gpt-4.1-mini",
        fallbackModelId: "anthropic/claude-sonnet-5",
      }),
    ).toBe("openai/gpt-4.1-mini");
    expect(
      pickWorkerModelId({
        keys: openaiOnly,
        modelId: "anthropic/claude-haiku-4.5",
        fallbackModelId: "openai/gpt-5.6-sol",
      }),
    ).toBe("openai/gpt-5.6-sol");
  });

  it("runs the fallback model when the primary call fails", async () => {
    const openaiOnly = { ...emptyKeys, openaiApiKey: "sk" };
    const seen: string[] = [];
    const result = await runWithModelFallback({
      keys: openaiOnly,
      modelId: "openai/gpt-4.1-mini",
      fallbackModelId: "openai/gpt-5.6-sol",
      run: async (modelId) => {
        seen.push(modelId);
        if (modelId === "openai/gpt-4.1-mini") throw new Error("primary down");
        return "ok";
      },
    });
    expect(result).toBe("ok");
    expect(seen).toEqual(["openai/gpt-4.1-mini", "openai/gpt-5.6-sol"]);
  });
});
