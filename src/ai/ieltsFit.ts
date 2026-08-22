import type { AiSettings } from "./types";

export const IELTS_SKILLS = [
  "writing",
  "reading",
  "listening",
  "speaking",
] as const;

export type IeltsSkill = (typeof IELTS_SKILLS)[number];

export type IeltsKeySlot =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "google"
  | "tavily"
  | "deepgram"
  | "elevenlabs"
  | "azure";

export type IeltsFit = 1 | 2 | 3;

export type IeltsChip = {
  skill: IeltsSkill | "web";
  fit: IeltsFit;
  why: string;
};

const LLM_FLAGSHIP: Record<"anthropic" | "openai" | "google", string> = {
  anthropic: "anthropic/claude-sonnet-5",
  openai: "openai/gpt-5.6-sol",
  google: "google/gemini-3.1-pro-preview",
};

/** Static fit of a Settings key field to IELTS tasks (chips). */
export const IELTS_KEY_CHIPS: Record<IeltsKeySlot, IeltsChip[]> = {
  openrouter: [
    {
      skill: "writing",
      fit: 2,
      why: "chat via OpenRouter; no native TTS or speech-to-text",
    },
    {
      skill: "reading",
      fit: 2,
      why: "chat via OpenRouter; no native TTS or speech-to-text",
    },
    {
      skill: "listening",
      fit: 1,
      why: "can write a script, but cannot synthesize exam audio",
    },
    {
      skill: "speaking",
      fit: 1,
      why: "examiner text only; no speech-to-text or TTS",
    },
  ],
  openai: [
    {
      skill: "writing",
      fit: 2,
      why: "works; flagship Claude is often stronger for band feedback",
    },
    {
      skill: "reading",
      fit: 2,
      why: "works; flagship Claude is often stronger for traps and keys",
    },
    {
      skill: "listening",
      fit: 2,
      why: "fallback TTS if Azure Speech is not set",
    },
    {
      skill: "speaking",
      fit: 3,
      why: "best fit (Whisper STT and TTS for the examiner)",
    },
  ],
  anthropic: [
    {
      skill: "writing",
      fit: 3,
      why: "best fit for prompts and band-style feedback",
    },
    {
      skill: "reading",
      fit: 3,
      why: "best fit for passages, questions, and trap notes",
    },
    {
      skill: "listening",
      fit: 1,
      why: "can write a script, but cannot synthesize exam audio",
    },
    {
      skill: "speaking",
      fit: 1,
      why: "examiner text only; no speech-to-text or TTS",
    },
  ],
  google: [
    {
      skill: "writing",
      fit: 2,
      why: "solid generated prompts; Claude is often stronger for bands",
    },
    {
      skill: "reading",
      fit: 2,
      why: "solid generated passages; Claude is often stronger for keys",
    },
    {
      skill: "listening",
      fit: 1,
      why: "can write a script, but cannot synthesize exam audio",
    },
    {
      skill: "speaking",
      fit: 1,
      why: "examiner text only; no speech-to-text or TTS",
    },
  ],
  tavily: [
    {
      skill: "web",
      fit: 3,
      why: "best fit for finding public practice pages",
    },
  ],
  deepgram: [
    {
      skill: "speaking",
      fit: 3,
      why: "best fit for low-latency speech-to-text",
    },
  ],
  elevenlabs: [
    {
      skill: "listening",
      fit: 2,
      why: "fallback TTS if Azure Speech is not set",
    },
    {
      skill: "speaking",
      fit: 3,
      why: "best fit for a British examiner voice",
    },
  ],
  azure: [
    {
      skill: "listening",
      fit: 3,
      why: "best fit: British neural voices and letter-by-letter spelling",
    },
    {
      skill: "speaking",
      fit: 2,
      why: "pronunciation assessment; also a British examiner voice",
    },
  ],
};

export function ieltsChipTooltip(
  chip: IeltsChip,
  keyFilled: boolean,
): string {
  const label =
    chip.skill === "web"
      ? "Web find"
      : `IELTS ${chip.skill[0]!.toUpperCase()}${chip.skill.slice(1)}`;
  const score = `${chip.fit}/3`;
  const base = `${label}: ${score} — ${chip.why}.`;
  return keyFilled ? base : `${base} Add this key to use it.`;
}

function filled(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export type IeltsKeyBag = {
  openrouter: boolean;
  openai: boolean;
  anthropic: boolean;
  google: boolean;
  tavily: boolean;
  deepgram: boolean;
  elevenlabs: boolean;
  azure: boolean;
};

export function ieltsKeysFromSettings(settings: AiSettings): IeltsKeyBag {
  return {
    openrouter: filled(settings.apiKey),
    openai: filled(settings.openaiApiKey),
    anthropic: filled(settings.anthropicApiKey),
    google: filled(settings.googleApiKey),
    tavily: filled(settings.tavilyApiKey),
    deepgram: filled(settings.deepgramApiKey),
    elevenlabs: filled(settings.elevenLabsApiKey),
    azure: filled(settings.azureSpeechKey),
  };
}

function pickByFit(
  candidates: { fit: IeltsFit; ok: boolean; id: string }[],
): string | null {
  const ready = candidates.filter((c) => c.ok);
  if (ready.length === 0) return null;
  ready.sort((a, b) => b.fit - a.fit);
  return ready[0]!.id;
}

/** Flagship catalog id for generated IELTS text (3 → 2 → 1). */
export function pickIeltsTextModelId(settings: AiSettings): string | null {
  const keys = ieltsKeysFromSettings(settings);
  return pickByFit([
    { fit: 3, ok: keys.anthropic, id: LLM_FLAGSHIP.anthropic },
    { fit: 2, ok: keys.openai, id: LLM_FLAGSHIP.openai },
    { fit: 2, ok: keys.google, id: LLM_FLAGSHIP.google },
    { fit: 1, ok: keys.openrouter, id: LLM_FLAGSHIP.anthropic },
  ]);
}

export type IeltsTtsRoute =
  | { provider: "azure"; apiKey: string; region: string }
  | { provider: "openai"; apiKey: string }
  | { provider: "elevenlabs"; apiKey: string };

export function pickIeltsTts(settings: AiSettings): IeltsTtsRoute | null {
  if (hasIeltsAzure(settings)) {
    return {
      provider: "azure",
      apiKey: settings.azureSpeechKey.trim(),
      region: settings.azureSpeechRegion.trim(),
    };
  }
  if (filled(settings.openaiApiKey)) {
    return { provider: "openai", apiKey: settings.openaiApiKey.trim() };
  }
  if (filled(settings.elevenLabsApiKey)) {
    return { provider: "elevenlabs", apiKey: settings.elevenLabsApiKey.trim() };
  }
  return null;
}

export type IeltsSttRoute =
  | { provider: "deepgram"; apiKey: string }
  | { provider: "openai"; apiKey: string };

export function pickIeltsStt(settings: AiSettings): IeltsSttRoute | null {
  if (filled(settings.deepgramApiKey)) {
    return { provider: "deepgram", apiKey: settings.deepgramApiKey.trim() };
  }
  if (filled(settings.openaiApiKey)) {
    return { provider: "openai", apiKey: settings.openaiApiKey.trim() };
  }
  return null;
}

export function hasIeltsAzure(settings: AiSettings): boolean {
  return (
    filled(settings.azureSpeechKey) && filled(settings.azureSpeechRegion)
  );
}

export function missingIeltsTextKeyMessage(): string {
  return "Add an Anthropic, OpenAI, Google, or OpenRouter API key in Settings → API keys to generate IELTS practice.";
}

export function missingIeltsTtsMessage(): string {
  return "Add Azure Speech (key + region), or an OpenAI / ElevenLabs key, in Settings → API keys to generate Listening audio.";
}

export function missingIeltsSttMessage(): string {
  return "Add a Deepgram or OpenAI API key in Settings → API keys to use the microphone.";
}
