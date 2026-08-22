import {
  httpFetchBytes,
  httpPostMultipart,
} from "../lib/vaultApi";
import {
  hasIeltsAzure,
  pickIeltsStt,
  pickIeltsTts,
  type IeltsSttRoute,
  type IeltsTtsRoute,
} from "./ieltsFit";
import {
  dialogueToAzureSsml,
  expandIeltsTtsText,
  groupDialogueTurns,
  utteranceToAzureSsml,
  type DialogueLine,
} from "./ieltsDialogue";
import { prepareIeltsPlaybackWav, wrapPcm16LeWav } from "./ieltsPlayback";
import type { AiSettings } from "./types";

const OPENAI_TTS_VOICES = ["onyx", "nova", "echo", "shimmer"] as const;
const ELEVEN_VOICES = [
  "JBFqnCBsd6RMkjVDRZzb",
  "21m00Tcm4TlvDq8ikWAM",
] as const;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeBase64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function looksLikeJson(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]!;
    if (c === 32 || c === 9 || c === 10 || c === 13) continue;
    return c === 123 || c === 91;
  }
  return false;
}

async function openaiTts(
  apiKey: string,
  text: string,
  voice: string,
  speed: number,
): Promise<Uint8Array> {
  const res = await httpFetchBytes("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    timeoutSecs: 90,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text.slice(0, 4000),
      voice,
      speed,
      response_format: "wav",
    }),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`OpenAI TTS failed (${res.status})`);
  }
  const bytes = decodeBase64(res.dataBase64);
  if (res.contentType?.includes("json") || looksLikeJson(bytes)) {
    const msg = new TextDecoder().decode(bytes).slice(0, 240);
    throw new Error(`OpenAI TTS failed: ${msg || String(res.status)}`);
  }
  return bytes;
}

async function elevenTts(
  apiKey: string,
  text: string,
  voiceId: string,
  speed: number,
): Promise<Uint8Array> {
  const res = await httpFetchBytes(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_24000`,
    {
      method: "POST",
      timeoutSecs: 90,
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/pcm",
      },
      body: JSON.stringify({
        text: text.slice(0, 4000),
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.7,
          style: 0.15,
          speed,
        },
      }),
    },
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`ElevenLabs TTS failed (${res.status})`);
  }
  const pcm = decodeBase64(res.dataBase64);
  if (looksLikeJson(pcm)) {
    const msg = new TextDecoder().decode(pcm).slice(0, 240);
    throw new Error(`ElevenLabs TTS failed: ${msg}`);
  }
  return wrapPcm16LeWav(pcm, 24000);
}

async function azureTts(
  region: string,
  apiKey: string,
  ssml: string,
): Promise<Uint8Array> {
  const res = await httpFetchBytes(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      timeoutSecs: 120,
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/ssml+xml; charset=utf-8",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        "User-Agent": "MarkSpace",
      },
      body: ssml,
    },
  );
  if (res.status < 200 || res.status >= 300) {
    const hint = new TextDecoder()
      .decode(decodeBase64(res.dataBase64))
      .slice(0, 240);
    throw new Error(`Azure TTS failed (${res.status})${hint ? `: ${hint}` : ""}`);
  }
  const bytes = decodeBase64(res.dataBase64);
  if (looksLikeJson(bytes)) {
    const msg = new TextDecoder().decode(bytes).slice(0, 240);
    throw new Error(`Azure TTS failed: ${msg}`);
  }
  return bytes;
}

export async function synthesizeIeltsSpeech(params: {
  settings: AiSettings;
  text: string;
  voiceIndex?: number;
}): Promise<Uint8Array> {
  const route = pickIeltsTts(params.settings);
  if (!route) throw new Error("No TTS key");
  const i = Math.max(0, params.voiceIndex ?? 0);
  if (route.provider === "azure") {
    return azureTts(
      route.region,
      route.apiKey,
      utteranceToAzureSsml(params.text, i),
    );
  }
  const spoken = expandIeltsTtsText(params.text);
  if (route.provider === "openai") {
    const voice = OPENAI_TTS_VOICES[i % OPENAI_TTS_VOICES.length]!;
    const speed = spoken.slow ? 0.68 : 0.92;
    return openaiTts(route.apiKey, spoken.text, voice, speed);
  }
  const voice = ELEVEN_VOICES[i % ELEVEN_VOICES.length]!;
  return elevenTts(route.apiKey, spoken.text, voice, spoken.slow ? 0.72 : 0.88);
}

/** Full listening section as one neural clip (Azure) or stitched fallback clips. */
export async function synthesizeIeltsListening(params: {
  settings: AiSettings;
  lines: DialogueLine[];
}): Promise<{ bytes: Uint8Array; filename: "listening.mp3" | "listening.wav" }> {
  const route = pickIeltsTts(params.settings);
  if (!route) throw new Error("No TTS key");
  if (route.provider === "azure") {
    try {
      const bytes = await azureTts(
        route.region,
        route.apiKey,
        dialogueToAzureSsml(params.lines),
      );
      return { bytes, filename: "listening.wav" };
    } catch {
      return synthesizeIeltsListening({
        settings: {
          ...params.settings,
          azureSpeechKey: "",
          azureSpeechRegion: "",
        },
        lines: params.lines,
      });
    }
  }
  const turns = groupDialogueTurns(params.lines);
  const clipBytes: Uint8Array[] = [];
  for (const turn of turns) {
    clipBytes.push(
      await synthesizeIeltsSpeech({
        settings: params.settings,
        text: turn.text,
        voiceIndex: turn.voiceIndex,
      }),
    );
  }
  const prepared = await prepareIeltsPlaybackWav(clipBytes);
  if (prepared) {
    return { bytes: prepared.bytes, filename: "listening.wav" };
  }
  return { bytes: clipBytes[0]!, filename: "listening.wav" };
}

export function ttsRouteLabel(route: IeltsTtsRoute | null): string {
  if (!route) return "none";
  return route.provider;
}

async function openaiWhisper(apiKey: string, bytes: Uint8Array, mime: string): Promise<string> {
  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : "webm";
  const res = await httpPostMultipart({
    url: "https://api.openai.com/v1/audio/transcriptions",
    timeoutSecs: 90,
    headers: { Authorization: `Bearer ${apiKey}` },
    fields: { model: "whisper-1", language: "en" },
    fileField: "file",
    fileName: `speech.${ext}`,
    fileBase64: uint8ToBase64(bytes),
    fileMime: mime || "audio/webm",
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Whisper failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(res.body) as { text?: string };
  const text = parsed.text?.trim() ?? "";
  if (!text) throw new Error("Whisper returned empty text");
  return text;
}

async function deepgramStt(apiKey: string, bytes: Uint8Array, mime: string): Promise<string> {
  const res = await httpFetchBytes(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=en",
    {
      method: "POST",
      timeoutSecs: 90,
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": mime || "audio/webm",
      },
      bodyBase64: uint8ToBase64(bytes),
    },
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Deepgram failed (${res.status})`);
  }
  const parsed = JSON.parse(
    new TextDecoder().decode(decodeBase64(res.dataBase64)),
  ) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  const text =
    parsed.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  if (!text) throw new Error("Deepgram returned empty text");
  return text;
}

export async function transcribeIeltsSpeech(params: {
  settings: AiSettings;
  bytes: Uint8Array;
  mime: string;
}): Promise<{ text: string; provider: IeltsSttRoute["provider"] }> {
  const route = pickIeltsStt(params.settings);
  if (!route) throw new Error("No STT key");
  if (route.provider === "deepgram") {
    const text = await deepgramStt(route.apiKey, params.bytes, params.mime);
    return { text, provider: "deepgram" };
  }
  const text = await openaiWhisper(route.apiKey, params.bytes, params.mime);
  return { text, provider: "openai" };
}

export type AzurePronunciationResult = {
  accuracyScore: number | null;
  fluencyScore: number | null;
  completenessScore: number | null;
  pronunciationScore: number | null;
  raw?: string;
};

export async function assessAzurePronunciation(params: {
  settings: AiSettings;
  bytes: Uint8Array;
  mime: string;
  referenceText: string;
}): Promise<AzurePronunciationResult | null> {
  if (!hasIeltsAzure(params.settings)) return null;
  const region = params.settings.azureSpeechRegion.trim();
  const key = params.settings.azureSpeechKey.trim();
  const pad = JSON.stringify({
    ReferenceText: params.referenceText.slice(0, 2000),
    GradingSystem: "HundredMark",
    Granularity: "Word",
    Dimension: "Comprehensive",
    EnableMiscue: true,
  });
  const header = btoa(unescape(encodeURIComponent(pad)));
  const res = await httpFetchBytes(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-GB&format=detailed`,
    {
      method: "POST",
      timeoutSecs: 60,
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": params.mime || "audio/webm",
        "Pronunciation-Assessment": header,
        Accept: "application/json",
      },
      bodyBase64: uint8ToBase64(params.bytes),
    },
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Azure pronunciation failed (${res.status})`);
  }
  const raw = new TextDecoder().decode(decodeBase64(res.dataBase64));
  let parsed: {
    NBest?: {
      PronunciationAssessment?: {
        AccuracyScore?: number;
        FluencyScore?: number;
        CompletenessScore?: number;
        PronScore?: number;
      };
    }[];
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { accuracyScore: null, fluencyScore: null, completenessScore: null, pronunciationScore: null, raw };
  }
  const pa = parsed.NBest?.[0]?.PronunciationAssessment;
  return {
    accuracyScore: pa?.AccuracyScore ?? null,
    fluencyScore: pa?.FluencyScore ?? null,
    completenessScore: pa?.CompletenessScore ?? null,
    pronunciationScore: pa?.PronScore ?? null,
    raw: raw.slice(0, 4000),
  };
}
