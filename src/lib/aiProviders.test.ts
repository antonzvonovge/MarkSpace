import { describe, expect, it } from "vitest";
import {
  countModelsForProvider,
  createProvider,
  providerNameFromBaseUrl,
  resolveProvidersFromRaw,
} from "./aiProviders";

describe("providerNameFromBaseUrl", () => {
  it("recognizes known hosts", () => {
    expect(providerNameFromBaseUrl("https://openrouter.ai/api/v1")).toBe(
      "OpenRouter",
    );
    expect(providerNameFromBaseUrl("https://api.openai.com/v1")).toBe(
      "OpenAI",
    );
    expect(providerNameFromBaseUrl("https://litellm.corp/v1")).toBe("LiteLLM");
    expect(providerNameFromBaseUrl("http://localhost:11434/v1")).toBe("Ollama");
  });
});

describe("resolveProvidersFromRaw", () => {
  it("migrates a legacy key into one provider", () => {
    const result = resolveProvidersFromRaw(
      {},
      "sk-test",
      "https://proxy.example/v1",
    );
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.apiKey).toBe("sk-test");
    expect(result.defaultProviderId).toBe(result.providers[0]!.id);
    expect(result.openaiApiKey).toBe("sk-test");
  });

  it("keeps an explicit providers list", () => {
    const p = createProvider({
      id: "prv_keep",
      name: "Keep",
      baseUrl: "https://keep.example/v1",
      apiKey: "sk",
    });
    const result = resolveProvidersFromRaw(
      { providers: [p], defaultProviderId: "prv_keep" },
      "",
      "",
    );
    expect(result.providers[0]!.id).toBe("prv_keep");
    expect(result.defaultProviderId).toBe("prv_keep");
  });
});

describe("countModelsForProvider", () => {
  it("counts bound catalog entries", () => {
    expect(
      countModelsForProvider(
        [
          { id: "openai/gpt-5" },
          { id: "openai/gpt-5@prv_a" },
          { id: "google/gemini@prv_a" },
          { id: "openai/gpt-5@prv_b" },
        ],
        "prv_a",
      ),
    ).toBe(2);
  });
});
