import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS } from "../ai/types";
import { normalizeAiSettings } from "./aiSettingsStore";

describe("normalizeAiSettings", () => {
  it("returns defaults for null/invalid input", () => {
    expect(normalizeAiSettings(null)).toEqual(DEFAULT_AI_SETTINGS);
    expect(normalizeAiSettings(undefined)).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("keeps legacy openrouter apiKey and fills new BYOK fields", () => {
    const merged = normalizeAiSettings({
      apiKey: "sk-or-legacy",
      modelId: "openai/gpt-4.1",
    });
    expect(merged.apiKey).toBe("sk-or-legacy");
    expect(merged.openaiApiKey).toBe("");
    expect(merged.anthropicApiKey).toBe("");
    expect(merged.googleApiKey).toBe("");
    expect(merged.modelId).toBe("openai/gpt-4.1");
    expect(merged.baseUrl).toContain("openrouter.ai");
  });

  it("persists direct provider keys when present", () => {
    const merged = normalizeAiSettings({
      apiKey: "or",
      openaiApiKey: "sk-openai",
      anthropicApiKey: "sk-ant",
      googleApiKey: "AIza",
      tavilyApiKey: "tvly",
    });
    expect(merged.openaiApiKey).toBe("sk-openai");
    expect(merged.anthropicApiKey).toBe("sk-ant");
    expect(merged.googleApiKey).toBe("AIza");
    expect(merged.tavilyApiKey).toBe("tvly");
  });

  it("ignores non-string key fields", () => {
    const merged = normalizeAiSettings({
      // @ts-expect-error intentional bad persist shape
      openaiApiKey: 123,
      // @ts-expect-error intentional bad persist shape
      anthropicApiKey: null,
    });
    expect(merged.openaiApiKey).toBe("");
    expect(merged.anthropicApiKey).toBe("");
  });
});
