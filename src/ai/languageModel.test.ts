import { describe, expect, it } from "vitest";
import {
  credentialsFromSettings,
  hasAnyLlmCredentials,
  hasCredentialsForModel,
  missingCredentialsMessage,
  modelRouteViaLabel,
  pickWorkerModelId,
  planModelRoute,
  resolveLanguageModel,
  runWithModelFallback,
  stripVendorPrefix,
  toDirectProviderModelId,
  vendorFromModelId,
  type AiProviderCredentials,
} from "./languageModel";
import { OPENAI_BASE_URL, OPENROUTER_BASE_URL } from "./models";
import { DEFAULT_AI_SETTINGS } from "./types";

const emptyKeys: AiProviderCredentials = {
  openaiApiKey: "",
  openaiBaseUrl: OPENAI_BASE_URL,
  googleApiKey: "",
};

describe("vendor / id helpers", () => {
  it("detects vendor from catalog id", () => {
    expect(vendorFromModelId("google/gemini-2.5-pro")).toBe("google");
    expect(vendorFromModelId("openai/gpt-4.1")).toBe("openai");
    expect(vendorFromModelId("gpt-4.1")).toBe("openai");
  });

  it("strips vendor prefix", () => {
    expect(stripVendorPrefix("google/gemini-3.7-flash")).toBe(
      "gemini-3.7-flash",
    );
    expect(stripVendorPrefix("gpt-4.1")).toBe("gpt-4.1");
  });

  it("maps catalog ids to native provider ids", () => {
    expect(toDirectProviderModelId("openai", "openai/gpt-4.1-mini")).toBe(
      "gpt-4.1-mini",
    );
    expect(
      toDirectProviderModelId("google", "google/gemini-3.1-pro-preview"),
    ).toBe("gemini-3.1-pro-preview");
  });
});

describe("planModelRoute", () => {
  it("prefers direct provider key over the OpenAI gateway", () => {
    const plan = planModelRoute("google/gemini-3.7-flash", {
      ...emptyKeys,
      googleApiKey: "AIza-test",
      openaiApiKey: "sk-or-test",
    });
    expect(plan).toEqual({
      transport: "direct",
      vendor: "google",
      catalogModelId: "google/gemini-3.7-flash",
      providerModelId: "gemini-3.7-flash",
    });
  });

  it("falls back to the gateway on multi-vendor base URLs", () => {
    const plan = planModelRoute("google/gemini-2.5-flash", {
      ...emptyKeys,
      openaiApiKey: "sk-or-test",
      openaiBaseUrl: OPENROUTER_BASE_URL,
    });
    expect(plan).toEqual({
      transport: "gateway",
      vendor: "google",
      catalogModelId: "google/gemini-2.5-flash",
      providerModelId: "google/gemini-2.5-flash",
    });
  });

  it("rejects non-OpenAI models on the official OpenAI endpoint", () => {
    expect(() =>
      planModelRoute("google/gemini-3.6-flash", {
        ...emptyKeys,
        openaiApiKey: "sk-test",
      }),
    ).toThrow(/Google API key/);
  });

  it("routes OpenAI models directly on the official OpenAI endpoint", () => {
    const plan = planModelRoute("openai/gpt-4.1-mini", {
      ...emptyKeys,
      openaiApiKey: "sk-test",
    });
    expect(plan.transport).toBe("direct");
    expect(plan.providerModelId).toBe("gpt-4.1-mini");
  });

  it("routes OpenAI models via the gateway when base URL is a proxy", () => {
    const plan = planModelRoute("openai/gpt-4.1", {
      ...emptyKeys,
      openaiApiKey: "sk-proxy",
      openaiBaseUrl: "https://litellm.example/v1",
    });
    expect(plan).toEqual({
      transport: "gateway",
      vendor: "openai",
      catalogModelId: "openai/gpt-4.1",
      providerModelId: "gpt-4.1",
    });
  });

  it("throws a clear error when no suitable key exists", () => {
    expect(() =>
      planModelRoute("google/gemini-3.7-flash", emptyKeys),
    ).toThrow(/Google or OpenAI/);
  });

  it("uses the gateway when only an OpenAI key is set for another vendor", () => {
    const plan = planModelRoute("google/gemini-3.7-flash", {
      ...emptyKeys,
      openaiApiKey: "sk-openai",
      openaiBaseUrl: OPENROUTER_BASE_URL,
    });
    expect(plan.transport).toBe("gateway");
  });
});

describe("modelRouteViaLabel", () => {
  it("labels gateway routes with host", () => {
    expect(
      modelRouteViaLabel(
        { transport: "gateway", vendor: "openai" },
        "https://litellm.atott.top/v1",
      ),
    ).toBe("Gateway · litellm.atott.top");
  });

  it("labels direct routes with vendor", () => {
    expect(
      modelRouteViaLabel(
        { transport: "direct", vendor: "google" },
        "https://api.openai.com/v1",
      ),
    ).toBe("Direct · Google");
  });
});

describe("resolveLanguageModel gateway API selection", () => {
  const gatewayKeys: AiProviderCredentials = {
    ...emptyKeys,
    openaiApiKey: "sk-proxy",
    openaiBaseUrl: "https://litellm.example/v1",
  };

  it("uses Responses when OpenAI reasoning is enabled on a gateway", () => {
    const resolved = resolveLanguageModel({
      modelId: "openai/gpt-5.6-sol",
      keys: gatewayKeys,
      enableReasoning: true,
    });
    expect(resolved.transport).toBe("gateway");
    expect(resolved.model.provider).toBe("openai.responses");
    expect(resolved.providerOptions).toEqual({
      openai: {
        parallelToolCalls: true,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
      },
    });
  });

  it("keeps Chat Completions when reasoning is off on a gateway", () => {
    const resolved = resolveLanguageModel({
      modelId: "openai/gpt-5.6-sol",
      keys: gatewayKeys,
      enableReasoning: false,
    });
    expect(resolved.model.provider).toBe("openai.chat");
    expect(resolved.providerOptions).toBeUndefined();
  });

  it("uses Responses on the official OpenAI endpoint", () => {
    const resolved = resolveLanguageModel({
      modelId: "openai/gpt-5.6-sol",
      keys: { ...emptyKeys, openaiApiKey: "sk-test" },
      enableReasoning: true,
    });
    expect(resolved.transport).toBe("direct");
    expect(resolved.model.provider).toBe("openai.responses");
  });
});

describe("credential helpers", () => {
  it("reads keys from settings", () => {
    const keys = credentialsFromSettings({
      ...DEFAULT_AI_SETTINGS,
      baseUrl: "https://example.com/v1/",
      openaiApiKey: "  oa  ",
      googleApiKey: " g ",
    });
    expect(keys).toEqual({
      openaiApiKey: "oa",
      openaiBaseUrl: "https://example.com/v1",
      googleApiKey: "g",
    });
  });

  it("detects any LLM credentials", () => {
    expect(hasAnyLlmCredentials(DEFAULT_AI_SETTINGS)).toBe(false);
    expect(
      hasAnyLlmCredentials({ ...DEFAULT_AI_SETTINGS, googleApiKey: "x" }),
    ).toBe(true);
    expect(
      hasAnyLlmCredentials({ ...DEFAULT_AI_SETTINGS, openaiApiKey: "or" }),
    ).toBe(true);
  });

  it("checks credentials for a specific model", () => {
    const openaiOnly = {
      ...emptyKeys,
      openaiApiKey: "sk",
    };
    expect(hasCredentialsForModel("openai/gpt-4.1", openaiOnly)).toBe(true);
    expect(
      hasCredentialsForModel("google/gemini-3.7-flash", openaiOnly),
    ).toBe(false);
    expect(
      hasCredentialsForModel("google/gemini-3.7-flash", {
        ...openaiOnly,
        openaiBaseUrl: OPENROUTER_BASE_URL,
      }),
    ).toBe(true);
    expect(
      missingCredentialsMessage("google/gemini-3.7-flash", emptyKeys),
    ).toMatch(/Google or OpenAI/);
  });

  it("picks the worker model when credentials exist, else chat fallback", () => {
    const openaiOnly = { ...emptyKeys, openaiApiKey: "sk" };
    expect(
      pickWorkerModelId({
        keys: openaiOnly,
        modelId: "openai/gpt-4.1-mini",
        fallbackModelId: "openai/gpt-5.6-sol",
      }),
    ).toBe("openai/gpt-4.1-mini");
    expect(
      pickWorkerModelId({
        keys: openaiOnly,
        modelId: "google/gemini-3.5-flash-lite",
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
