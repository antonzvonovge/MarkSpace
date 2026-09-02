import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS } from "../ai/types";
import {
  aiSettingsNeedPersistRewrite,
  normalizeAiSettings,
} from "./aiSettingsStore";

describe("normalizeAiSettings", () => {
  it("returns defaults for null/invalid input", () => {
    expect(normalizeAiSettings(null)).toEqual(DEFAULT_AI_SETTINGS);
    expect(normalizeAiSettings(undefined)).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("migrates legacy OpenRouter apiKey into openaiApiKey and base URL", () => {
    const merged = normalizeAiSettings({
      apiKey: "sk-or-legacy",
      modelId: "openai/gpt-4.1-mini",
    });
    expect(merged.openaiApiKey).toBe("sk-or-legacy");
    expect(merged.googleApiKey).toBe("");
    expect(merged.modelId).toBe("openai/gpt-4.1-mini");
    expect(merged.baseUrl).toContain("openrouter.ai");
  });

  it("persists direct provider keys when present", () => {
    const merged = normalizeAiSettings({
      openaiApiKey: "sk-openai",
      googleApiKey: "AIza",
      tavilyApiKey: "tvly",
      firecrawlApiKey: "fc-",
      omdbApiKey: "omdb",
      kinopoiskApiKey: "kp",
    });
    expect(merged.openaiApiKey).toBe("sk-openai");
    expect(merged.googleApiKey).toBe("AIza");
    expect(merged.tavilyApiKey).toBe("tvly");
    expect(merged.firecrawlApiKey).toBe("fc-");
    expect(merged.omdbApiKey).toBe("omdb");
    expect(merged.kinopoiskApiKey).toBe("kp");
  });

  it("does not rewrite disk for models-catalog-only drift", () => {
    // Incomplete catalog row as persisted on disk (missing vendor/kind/tier).
    const raw = {
      ...DEFAULT_AI_SETTINGS,
      models: [{ id: "openai/custom", label: "Custom" }],
    } as Partial<typeof DEFAULT_AI_SETTINGS>;
    const merged = normalizeAiSettings(raw);
    expect(aiSettingsNeedPersistRewrite(raw, merged)).toBe(false);
    expect(aiSettingsNeedPersistRewrite(null, merged)).toBe(true);
  });

  it("rewrites disk when a legacy Anthropic key is present", () => {
    const raw = {
      ...DEFAULT_AI_SETTINGS,
      anthropicApiKey: "sk-ant",
    } as Partial<typeof DEFAULT_AI_SETTINGS> & { anthropicApiKey: string };
    const merged = normalizeAiSettings(raw);
    expect(aiSettingsNeedPersistRewrite(raw, merged)).toBe(true);
    expect(
      (merged as { anthropicApiKey?: string }).anthropicApiKey,
    ).toBeUndefined();
  });

  it("ignores non-string key fields", () => {
    const merged = normalizeAiSettings({
      // @ts-expect-error intentional bad persist shape
      openaiApiKey: 123,
      // @ts-expect-error intentional bad persist shape
      googleApiKey: null,
    });
    expect(merged.openaiApiKey).toBe("");
    expect(merged.googleApiKey).toBe("");
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

  it("infers worker tier for mini/luna/flash-lite custom ids", () => {
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
    expect(
      merged.models.some((m) => m.id.startsWith("anthropic/")),
    ).toBe(false);
    const sol = merged.models.find((m) => m.id === "openai/gpt-5.6-sol");
    expect(sol?.tier).toBe("flagship");
  });
});
