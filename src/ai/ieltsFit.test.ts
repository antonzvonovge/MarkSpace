import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS } from "./types";
import {
  IELTS_KEY_CHIPS,
  ieltsChipTooltip,
  pickIeltsStt,
  pickIeltsTextModelId,
  pickIeltsTts,
} from "./ieltsFit";

describe("ieltsFit", () => {
  it("rates Azure as 3 for listening", () => {
    const listening = IELTS_KEY_CHIPS.azure.find((c) => c.skill === "listening");
    expect(listening?.fit).toBe(3);
    expect(ieltsChipTooltip(listening!, true)).toContain("3/3");
  });

  it("rates OpenAI as 2 for listening and 3 for speaking", () => {
    const listening = IELTS_KEY_CHIPS.openai.find((c) => c.skill === "listening");
    const speaking = IELTS_KEY_CHIPS.openai.find((c) => c.skill === "speaking");
    expect(listening?.fit).toBe(2);
    expect(speaking?.fit).toBe(3);
    expect(ieltsChipTooltip(listening!, true)).toContain("2/3");
    expect(ieltsChipTooltip(listening!, false)).toContain("Add this key");
  });

  it("picks Anthropic flagship for text when that key is set", () => {
    const settings = {
      ...DEFAULT_AI_SETTINGS,
      anthropicApiKey: "sk-ant",
      openaiApiKey: "sk-openai",
    };
    expect(pickIeltsTextModelId(settings)).toBe("anthropic/claude-sonnet-5");
  });

  it("falls back OpenAI then Google then OpenRouter for text", () => {
    expect(
      pickIeltsTextModelId({
        ...DEFAULT_AI_SETTINGS,
        openaiApiKey: "sk",
      }),
    ).toBe("openai/gpt-5.6-sol");
    expect(
      pickIeltsTextModelId({
        ...DEFAULT_AI_SETTINGS,
        googleApiKey: "AIza",
      }),
    ).toBe("google/gemini-3.1-pro-preview");
    expect(
      pickIeltsTextModelId({
        ...DEFAULT_AI_SETTINGS,
        apiKey: "sk-or",
      }),
    ).toBe("anthropic/claude-sonnet-5");
    expect(pickIeltsTextModelId(DEFAULT_AI_SETTINGS)).toBeNull();
  });

  it("prefers Azure TTS over OpenAI, Deepgram STT over Whisper", () => {
    expect(
      pickIeltsTts({
        ...DEFAULT_AI_SETTINGS,
        azureSpeechKey: "az",
        azureSpeechRegion: "westeurope",
        openaiApiKey: "sk",
        elevenLabsApiKey: "el",
      })?.provider,
    ).toBe("azure");
    expect(
      pickIeltsTts({
        ...DEFAULT_AI_SETTINGS,
        openaiApiKey: "sk",
        elevenLabsApiKey: "el",
      })?.provider,
    ).toBe("openai");
    expect(
      pickIeltsStt({
        ...DEFAULT_AI_SETTINGS,
        openaiApiKey: "sk",
        deepgramApiKey: "dg",
      })?.provider,
    ).toBe("deepgram");
  });
});
