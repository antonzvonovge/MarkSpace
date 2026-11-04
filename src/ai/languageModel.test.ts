import type { LanguageModel } from "ai";
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
  resolveSpecialistModelId,
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
  providers: [],
  defaultProviderId: null,
};

function keysWithGateway(
  patch: Partial<AiProviderCredentials> & {
    openaiApiKey: string;
    openaiBaseUrl?: string;
  },
): AiProviderCredentials {
  const baseUrl = patch.openaiBaseUrl ?? OPENAI_BASE_URL;
  const id = "prv_testgw";
  return {
    ...emptyKeys,
    ...patch,
    openaiBaseUrl: baseUrl,
    providers: [
      {
        id,
        name: "Test gateway",
        kind: "openaiCompatible",
        baseUrl,
        apiKey: patch.openaiApiKey,
        enabled: true,
      },
    ],
    defaultProviderId: id,
  };
}

/** `LanguageModel` may be a string id; SDK instances expose `.provider`. */
function languageModelProvider(model: LanguageModel): string {
  if (typeof model === "string") {
    throw new Error(`expected LanguageModel instance, got id ${model}`);
  }
  return model.provider;
}

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
    expect(plan).toMatchObject({
      transport: "direct",
      vendor: "google",
      catalogModelId: "google/gemini-3.7-flash",
      bareModelId: "google/gemini-3.7-flash",
      providerModelId: "gemini-3.7-flash",
      providerId: null,
    });
  });

  it("falls back to the gateway on multi-vendor base URLs", () => {
    const keys = keysWithGateway({
      openaiApiKey: "sk-or-test",
      openaiBaseUrl: OPENROUTER_BASE_URL,
    });
    const plan = planModelRoute("google/gemini-2.5-flash", keys);
    expect(plan).toMatchObject({
      transport: "gateway",
      vendor: "google",
      catalogModelId: "google/gemini-2.5-flash",
      bareModelId: "google/gemini-2.5-flash",
      providerModelId: "google/gemini-2.5-flash",
      providerId: "prv_testgw",
    });
  });

  it("rejects non-OpenAI models on the official OpenAI endpoint", () => {
    expect(() =>
      planModelRoute(
        "google/gemini-3.6-flash",
        keysWithGateway({ openaiApiKey: "sk-test" }),
      ),
    ).toThrow(/Google API key/);
  });

  it("routes OpenAI models directly on the official OpenAI endpoint", () => {
    const plan = planModelRoute(
      "openai/gpt-4.1-mini",
      keysWithGateway({ openaiApiKey: "sk-test" }),
    );
    expect(plan.transport).toBe("direct");
    expect(plan.providerModelId).toBe("gpt-4.1-mini");
  });

  it("routes OpenAI models via the gateway when base URL is a proxy", () => {
    const keys = keysWithGateway({
      openaiApiKey: "sk-proxy",
      openaiBaseUrl: "https://litellm.example/v1",
    });
    const plan = planModelRoute("openai/gpt-4.1", keys);
    expect(plan).toMatchObject({
      transport: "gateway",
      vendor: "openai",
      catalogModelId: "openai/gpt-4.1",
      providerModelId: "gpt-4.1",
      providerId: "prv_testgw",
    });
  });

  it("routes a model bound to a specific provider", () => {
    const keys: AiProviderCredentials = {
      ...emptyKeys,
      providers: [
        {
          id: "prv_work",
          name: "Work LiteLLM",
          kind: "openaiCompatible",
          baseUrl: "https://work.example/v1",
          apiKey: "sk-work",
          enabled: true,
        },
        {
          id: "prv_home",
          name: "Home",
          kind: "openaiCompatible",
          baseUrl: OPENROUTER_BASE_URL,
          apiKey: "sk-home",
          enabled: true,
        },
      ],
      defaultProviderId: "prv_home",
      openaiApiKey: "sk-home",
      openaiBaseUrl: OPENROUTER_BASE_URL,
    };
    const plan = planModelRoute("openai/gpt-5@prv_work", keys);
    expect(plan).toMatchObject({
      transport: "gateway",
      providerId: "prv_work",
      providerName: "Work LiteLLM",
      bareModelId: "openai/gpt-5",
      catalogModelId: "openai/gpt-5@prv_work",
    });
  });

  it("rejects a bound model whose provider was removed", () => {
    expect(() =>
      planModelRoute("openai/gpt-5@prv_gone", emptyKeys),
    ).toThrow(/removed/i);
  });

  it("rejects a bound model whose provider is disabled", () => {
    const keys: AiProviderCredentials = {
      ...emptyKeys,
      providers: [
        {
          id: "prv_off",
          name: "Off",
          kind: "openaiCompatible",
          baseUrl: "https://proxy.example/v1",
          apiKey: "sk",
          enabled: false,
        },
      ],
      defaultProviderId: "prv_off",
    };
    expect(() => planModelRoute("openai/gpt-5@prv_off", keys)).toThrow(
      /disabled/i,
    );
  });

  it("throws a clear error when no suitable key exists", () => {
    expect(() =>
      planModelRoute("google/gemini-3.7-flash", emptyKeys),
    ).toThrow(/Google or OpenAI/);
  });

  it("uses the gateway when only an OpenAI key is set for another vendor", () => {
    const plan = planModelRoute(
      "google/gemini-3.7-flash",
      keysWithGateway({
        openaiApiKey: "sk-openai",
        openaiBaseUrl: OPENROUTER_BASE_URL,
      }),
    );
    expect(plan.transport).toBe("gateway");
  });
});

describe("modelRouteViaLabel", () => {
  it("labels gateway routes with provider name when known", () => {
    expect(
      modelRouteViaLabel(
        {
          transport: "gateway",
          vendor: "openai",
          providerName: "Work LiteLLM",
          providerId: "prv_work",
        },
        "https://litellm.atott.top/v1",
      ),
    ).toBe("Via Work LiteLLM");
  });

  it("labels gateway routes with host when name is missing", () => {
    expect(
      modelRouteViaLabel(
        {
          transport: "gateway",
          vendor: "openai",
          providerName: null,
          providerId: null,
        },
        "https://litellm.atott.top/v1",
      ),
    ).toBe("Gateway · litellm.atott.top");
  });

  it("labels direct routes with vendor", () => {
    expect(
      modelRouteViaLabel(
        {
          transport: "direct",
          vendor: "google",
          providerName: null,
          providerId: null,
        },
        "https://api.openai.com/v1",
      ),
    ).toBe("Direct · Google");
  });
});

describe("resolveLanguageModel gateway API selection", () => {
  const gatewayKeys: AiProviderCredentials = keysWithGateway({
    openaiApiKey: "sk-proxy",
    openaiBaseUrl: "https://litellm.example/v1",
  });

  it("uses Responses when OpenAI reasoning is enabled on a gateway", () => {
    const resolved = resolveLanguageModel({
      modelId: "openai/gpt-5.6-sol",
      keys: gatewayKeys,
      enableReasoning: true,
    });
    expect(resolved.transport).toBe("gateway");
    expect(languageModelProvider(resolved.model)).toBe("openai.responses");
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
    expect(languageModelProvider(resolved.model)).toBe("openai.chat");
    expect(resolved.providerOptions).toBeUndefined();
  });

  it("uses Responses on the official OpenAI endpoint", () => {
    const resolved = resolveLanguageModel({
      modelId: "openai/gpt-5.6-sol",
      keys: keysWithGateway({ openaiApiKey: "sk-test" }),
      enableReasoning: true,
    });
    expect(resolved.transport).toBe("direct");
    expect(languageModelProvider(resolved.model)).toBe("openai.responses");
  });
});

describe("credential helpers", () => {
  it("reads keys from settings", () => {
    const keys = credentialsFromSettings({
      ...DEFAULT_AI_SETTINGS,
      baseUrl: "https://example.com/v1/",
      openaiApiKey: "  oa  ",
      googleApiKey: " g ",
      providers: [
        {
          id: "prv_ex",
          name: "Example",
          kind: "openaiCompatible",
          baseUrl: "https://example.com/v1/",
          apiKey: "  oa  ",
          enabled: true,
        },
      ],
      defaultProviderId: "prv_ex",
    });
    expect(keys.openaiApiKey).toBe("oa");
    expect(keys.openaiBaseUrl).toBe("https://example.com/v1");
    expect(keys.googleApiKey).toBe("g");
    expect(keys.providers).toHaveLength(1);
    expect(keys.defaultProviderId).toBe("prv_ex");
  });

  it("detects any LLM credentials", () => {
    expect(hasAnyLlmCredentials(DEFAULT_AI_SETTINGS)).toBe(false);
    expect(
      hasAnyLlmCredentials({ ...DEFAULT_AI_SETTINGS, googleApiKey: "x" }),
    ).toBe(true);
    expect(
      hasAnyLlmCredentials({
        ...DEFAULT_AI_SETTINGS,
        openaiApiKey: "or",
        providers: [
          {
            id: "prv_or",
            name: "OR",
            kind: "openaiCompatible",
            baseUrl: OPENROUTER_BASE_URL,
            apiKey: "or",
            enabled: true,
          },
        ],
        defaultProviderId: "prv_or",
      }),
    ).toBe(true);
  });

  it("checks credentials for a specific model", () => {
    const openaiOnly = keysWithGateway({ openaiApiKey: "sk" });
    expect(hasCredentialsForModel("openai/gpt-4.1", openaiOnly)).toBe(true);
    expect(
      hasCredentialsForModel("google/gemini-3.7-flash", openaiOnly),
    ).toBe(false);
    expect(
      hasCredentialsForModel(
        "google/gemini-3.7-flash",
        keysWithGateway({
          openaiApiKey: "sk",
          openaiBaseUrl: OPENROUTER_BASE_URL,
        }),
      ),
    ).toBe(true);
    expect(
      missingCredentialsMessage("google/gemini-3.7-flash", emptyKeys),
    ).toMatch(/Google or OpenAI/);
  });

  it("picks the worker model when credentials exist, else chat fallback", () => {
    const openaiOnly = keysWithGateway({ openaiApiKey: "sk" });
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

  it("resolves specialist model from worker or chat sticky toggle", () => {
    const openaiOnly = keysWithGateway({ openaiApiKey: "sk" });
    expect(
      resolveSpecialistModelId({
        keys: openaiOnly,
        useChatModel: false,
        chatModelId: "openai/gpt-5.6-sol",
        specialistModelId: "openai/gpt-4.1-mini",
        fallbackModelId: "openai/gpt-5.6-sol",
      }),
    ).toBe("openai/gpt-4.1-mini");
    expect(
      resolveSpecialistModelId({
        keys: openaiOnly,
        useChatModel: true,
        chatModelId: "openai/gpt-5.6-sol",
        specialistModelId: "openai/gpt-4.1-mini",
        fallbackModelId: "openai/gpt-5.6-sol",
      }),
    ).toBe("openai/gpt-5.6-sol");
    expect(
      resolveSpecialistModelId({
        keys: openaiOnly,
        useChatModel: true,
        chatModelId: "google/gemini-3.5-flash-lite",
        specialistModelId: "openai/gpt-4.1-mini",
        fallbackModelId: "openai/gpt-5.6-sol",
      }),
    ).toBe("openai/gpt-4.1-mini");
  });

  it("runs the fallback model when the primary call fails", async () => {
    const openaiOnly = keysWithGateway({ openaiApiKey: "sk" });
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
