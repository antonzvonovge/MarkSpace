import { generateText } from "ai";
import { z } from "zod";
import { nativeLanguageLabel } from "../settings/types";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { usePrefsStore } from "../store/prefsStore";
import { helperModelCallParams } from "../store/vaultAiSettingsStore";
import {
  credentialsFromSettings,
  resolveLanguageModel,
  runWithModelFallback,
} from "./languageModel";
import { missingIeltsTextKeyMessage, pickIeltsTextModelId } from "./ieltsFit";

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error("Model did not return JSON");
  }
}

async function generateJson(
  system: string,
  prompt: string,
  temperature: number,
): Promise<unknown> {
  const settings = useAiSettingsStore.getState().settings;
  const keys = credentialsFromSettings(settings);
  const flagship = pickIeltsTextModelId(settings);
  if (!flagship) throw new Error(missingIeltsTextKeyMessage());
  const helper = helperModelCallParams();
  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system,
      prompt,
      maxOutputTokens: 2000,
      temperature,
    });
    return extractJsonObject(text);
  };
  return runWithModelFallback({
    keys,
    modelId: flagship,
    fallbackModelId: helper.fallbackModelId,
    run: tryModel,
  });
}

const EXAMINER_SYSTEM = `You are a concise IELTS Speaking examiner in a notes app (General Training style).
Run Part 1 (4–5 short questions), then Part 2 (cue card — give 1 minute to prepare, then 1–2 minutes to speak), then Part 3 (4–6 abstract follow-ups).
Do not lecture. One or two short sentences plus the next question. English only until the session is graded.
Return JSON only: {"message":"..."}`;

export type SpeakingTurn = { role: "examiner" | "candidate"; text: string };

export async function generateSpeakingOpening(existingTopics: string[]): Promise<string> {
  const avoid =
    existingTopics.length > 0
      ? `Do not reuse cue-card themes: ${existingTopics.join(", ")}.`
      : "Pick a fresh everyday Part 1 topic.";
  const raw = await generateJson(
    EXAMINER_SYSTEM,
    `Start Part 1 now. Greet briefly and ask the first question. ${avoid}`,
    0.7,
  );
  const parsed = z.object({ message: z.string().min(1) }).parse(raw);
  return parsed.message.trim();
}

export async function generateSpeakingReply(
  history: SpeakingTurn[],
): Promise<string> {
  const transcript = history
    .map((t) => `${t.role === "examiner" ? "Examiner" : "Candidate"}: ${t.text}`)
    .join("\n");
  const raw = await generateJson(
    EXAMINER_SYSTEM,
    `Continue the test. Transcript so far:\n${transcript.slice(-12000)}\n\nReply as the examiner.`,
    0.7,
  );
  const parsed = z.object({ message: z.string().min(1) }).parse(raw);
  return parsed.message.trim();
}

const gradeSchema = z.object({
  fluency: z.number(),
  lr: z.number(),
  gra: z.number(),
  recap: z.string().min(1),
  fixes: z.array(z.string()).max(6),
});

export type SpeakingGradeResult = z.infer<typeof gradeSchema>;

export async function gradeSpeakingSession(
  history: SpeakingTurn[],
): Promise<SpeakingGradeResult> {
  const native = usePrefsStore.getState().prefs.nativeLanguage;
  const nativeLabel = nativeLanguageLabel(native);
  const transcript = history
    .map((t) => `${t.role === "examiner" ? "Examiner" : "Candidate"}: ${t.text}`)
    .join("\n");
  const raw = await generateJson(
    `Grade this IELTS Speaking practice. Indicative bands 0–9 in 0.5 steps (fluency, lexical resource, grammar). Not official Cambridge.
Write recap and fixes in ${nativeLabel} (${native}). Keep quoted English as-is.
Return JSON only: {"fluency":6.0,"lr":6.0,"gra":6.0,"recap":"...","fixes":["...","...","..."]}`,
    `Transcript:\n${transcript.slice(-14000)}`,
    0.3,
  );
  return gradeSchema.parse(raw);
}

export function formatSpeakingNoteMarkdown(params: {
  grade: SpeakingGradeResult;
  history: SpeakingTurn[];
}): string {
  const g = params.grade;
  const lines = [
    "# IELTS Speaking",
    "",
    `**Indicative:** Fluency ${g.fluency} · LR ${g.lr} · GRA ${g.gra}`,
    "",
    g.recap,
    "",
  ];
  if (g.fixes.length) {
    lines.push("## Fixes", "");
    for (const fix of g.fixes) lines.push(`- ${fix}`);
    lines.push("");
  }
  lines.push("## Transcript", "");
  for (const turn of params.history) {
    const who = turn.role === "examiner" ? "Examiner" : "Candidate";
    lines.push(`**${who}:** ${turn.text}`, "");
  }
  return lines.join("\n");
}
