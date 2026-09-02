import { describe, expect, it } from "vitest";
import { OPENROUTER_MODELS } from "../ai/models";
import {
  DEFAULT_WORKER_MODEL_ID,
  effectiveChatModelId,
  effectiveWorkerModelId,
  EMPTY_VAULT_AI_SETTINGS,
  normalizeVaultAiSettings,
} from "./vaultAiSettings";

describe("normalizeVaultAiSettings", () => {
  it("returns empty ids for null/invalid input", () => {
    expect(normalizeVaultAiSettings(null)).toEqual(EMPTY_VAULT_AI_SETTINGS);
    expect(normalizeVaultAiSettings(undefined)).toEqual(EMPTY_VAULT_AI_SETTINGS);
  });

  it("keeps vendor/model ids and drops invalid ones", () => {
    const doc = normalizeVaultAiSettings({
      version: 9,
      chatModelId: " openai/gpt-5.6-sol ",
      workerModelId: "gpt-4.1-mini",
    });
    expect(doc.version).toBe(1);
    expect(doc.chatModelId).toBe("openai/gpt-5.6-sol");
    expect(doc.workerModelId).toBeNull();
  });
});

describe("effective vault model ids", () => {
  it("inherits app chat model and built-in worker when vault file is empty", () => {
    expect(
      effectiveChatModelId(EMPTY_VAULT_AI_SETTINGS, "openai/gpt-5.6-terra"),
    ).toBe("openai/gpt-5.6-terra");
    expect(effectiveWorkerModelId(EMPTY_VAULT_AI_SETTINGS)).toBe(
      DEFAULT_WORKER_MODEL_ID,
    );
  });

  it("prefers explicit vault ids", () => {
    const doc = normalizeVaultAiSettings({
      chatModelId: "openai/gpt-5.6-sol",
      workerModelId: "google/gemini-3.5-flash-lite",
    });
    expect(effectiveChatModelId(doc, "openai/gpt-5.6-terra")).toBe(
      "openai/gpt-5.6-sol",
    );
    expect(effectiveWorkerModelId(doc)).toBe("google/gemini-3.5-flash-lite");
  });
});

describe("curated catalog tiers", () => {
  it("gives every vendor both flagship and worker models", () => {
    for (const vendor of ["openai", "google"] as const) {
      const group = OPENROUTER_MODELS.filter((m) => m.vendor === vendor);
      expect(group.some((m) => m.tier === "flagship")).toBe(true);
      expect(group.some((m) => m.tier === "worker")).toBe(true);
    }
  });

  it("keeps the default worker in the catalog", () => {
    expect(OPENROUTER_MODELS.some((m) => m.id === DEFAULT_WORKER_MODEL_ID)).toBe(
      true,
    );
  });
});
