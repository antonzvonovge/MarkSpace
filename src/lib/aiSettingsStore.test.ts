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
      modelId: "openai/gpt-4.1-mini",
    });
    expect(merged.apiKey).toBe("sk-or-legacy");
    expect(merged.openaiApiKey).toBe("");
    expect(merged.anthropicApiKey).toBe("");
    expect(merged.googleApiKey).toBe("");
    expect(merged.modelId).toBe("openai/gpt-4.1-mini");
    expect(merged.baseUrl).toContain("openrouter.ai");
  });

  it("persists direct provider keys when present", () => {
    const merged = normalizeAiSettings({
      apiKey: "or",
      openaiApiKey: "sk-openai",
      anthropicApiKey: "sk-ant",
      googleApiKey: "AIza",
      tavilyApiKey: "tvly",
      firecrawlApiKey: "fc-",
    });
    expect(merged.openaiApiKey).toBe("sk-openai");
    expect(merged.anthropicApiKey).toBe("sk-ant");
    expect(merged.googleApiKey).toBe("AIza");
    expect(merged.tavilyApiKey).toBe("tvly");
    expect(merged.firecrawlApiKey).toBe("fc-");
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

  it("clamps agentMaxSteps and defaults when missing", () => {
    expect(normalizeAiSettings({}).agentMaxSteps).toBe(
      DEFAULT_AI_SETTINGS.agentMaxSteps,
    );
    expect(normalizeAiSettings({ agentMaxSteps: 0 }).agentMaxSteps).toBe(1);
    expect(normalizeAiSettings({ agentMaxSteps: 99 }).agentMaxSteps).toBe(64);
    expect(normalizeAiSettings({ agentMaxSteps: 24.6 }).agentMaxSteps).toBe(25);
    expect(normalizeAiSettings({}).agentTerminalEnabled).toBe(false);
    expect(normalizeAiSettings({ agentTerminalEnabled: true }).agentTerminalEnabled).toBe(
      true,
    );
    expect(
      normalizeAiSettings({
        // @ts-expect-error intentional bad persist shape
        agentTerminalEnabled: "yes",
      }).agentTerminalEnabled,
    ).toBe(false);
  });

  it("infers worker tier for mini/haiku/luna/flash-lite custom ids", () => {
    const merged = normalizeAiSettings({
      models: [
        {
          id: "openai/custom-mini",
          label: "Custom Mini",
          vendor: "openai",
          kind: "chat",
        } as unknown as (typeof DEFAULT_AI_SETTINGS)["models"][number],
      ],
    });
    const custom = merged.models.find((m) => m.id === "openai/custom-mini");
    expect(custom?.tier).toBe("worker");
    const haiku = merged.models.find((m) => m.id === "anthropic/claude-haiku-4.5");
    expect(haiku?.tier).toBe("worker");
    const sol = merged.models.find((m) => m.id === "openai/gpt-5.6-sol");
    expect(sol?.tier).toBe("flagship");
  });
});
