import { describe, expect, it } from "vitest";
import {
  enrichModelFromLiteLlm,
  labelFromModelId,
  mergeUserModels,
  normalizeCatalogModels,
} from "./modelCatalog";
import { OPENROUTER_MODELS } from "../ai/models";
import type { ModelMetaMap } from "../ai/modelPrices";

describe("labelFromModelId", () => {
  it("humanizes bare ids", () => {
    expect(labelFromModelId("google/gemini-3.8-flash")).toBe(
      "Gemini 3.8 Flash",
    );
    expect(labelFromModelId("openai/gpt-4.1-mini")).toBe("GPT 4.1 Mini");
  });
});

describe("mergeUserModels", () => {
  it("seeds curated catalog when empty", () => {
    expect(mergeUserModels(null)).toEqual(OPENROUTER_MODELS);
    expect(mergeUserModels([])).toEqual(OPENROUTER_MODELS);
  });

  it("keeps a user list without re-injecting missing curated ids", () => {
    const custom = [
      {
        id: "google/gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        vendor: "google" as const,
        kind: "reasoning" as const,
        tier: "flagship" as const,
        contextWindow: 1_048_576,
      },
    ];
    const merged = mergeUserModels(custom);
    expect(merged.map((m) => m.id)).toEqual(["google/gemini-3.8-flash"]);
    expect(merged.some((m) => m.id === "openai/gpt-5.6-sol")).toBe(false);
  });
});

describe("enrichModelFromLiteLlm", () => {
  const meta: ModelMetaMap = {
    "gemini-3.8-flash": {
      supportsReasoning: true,
      maxInputTokens: 1_048_576,
    },
    "gemini-3.5-flash-lite": {
      supportsReasoning: true,
      maxInputTokens: 1_048_576,
    },
    "gpt-4.1-mini": {
      supportsReasoning: false,
      maxInputTokens: 1_047_576,
    },
  };

  it("takes reasoning and context from LiteLLM meta", () => {
    const { model, inMap } = enrichModelFromLiteLlm(
      "google/gemini-3.8-flash",
      meta,
    );
    expect(inMap).toBe(true);
    expect(model.kind).toBe("reasoning");
    expect(model.contextWindow).toBe(1_048_576);
    expect(model.tier).toBe("flagship");
    expect(model.vendor).toBe("google");
  });

  it("marks flash-lite as reasoning when LiteLLM says so, worker via heuristic", () => {
    const { model } = enrichModelFromLiteLlm(
      "google/gemini-3.5-flash-lite",
      meta,
    );
    expect(model.kind).toBe("reasoning");
    expect(model.tier).toBe("worker");
  });

  it("falls back when meta is missing", () => {
    const { model, inMap } = enrichModelFromLiteLlm(
      "openai/totally-custom-xyz",
      meta,
    );
    expect(inMap).toBe(false);
    expect(model.id).toBe("openai/totally-custom-xyz");
    expect(model.label).toContain("Custom");
  });
});

describe("normalizeCatalogModels", () => {
  it("drops anthropic and duplicate ids", () => {
    const out = normalizeCatalogModels([
      {
        id: "openai/a",
        label: "A",
        vendor: "openai",
        kind: "chat",
        tier: "flagship",
      },
      {
        id: "openai/a",
        label: "A2",
        vendor: "openai",
        kind: "chat",
        tier: "flagship",
      },
      {
        id: "anthropic/claude",
        label: "Claude",
        vendor: "openai",
        kind: "chat",
        tier: "flagship",
      },
    ]);
    expect(out.map((m) => m.id)).toEqual(["openai/a"]);
  });
});
