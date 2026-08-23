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
import {
  missingIeltsTextKeyMessage,
  pickIeltsTextModelId,
  type IeltsSkill,
} from "./ieltsFit";
import {
  formatIeltsPaperAsMarkdown,
  ieltsPaperFieldsSchema,
  normalizeIeltsPaper,
  type IeltsPaper,
  type IeltsPaperAnswerItem,
} from "./ieltsPaper";
import type { DialogueLine } from "./ieltsDialogue";
import { markdownCoreRules } from "./markdownFormat";

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

async function generateJson(system: string, prompt: string): Promise<unknown> {
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
    const dialect = markdownCoreRules()
      .map((rule) => `- ${rule}`)
      .join("\n");
    const { text } = await generateText({
      model: resolved.model,
      system: `${system}

MarkSpace Markdown dialect (the session note is saved in this dialect). Recap and trap notes: plain paragraphs only — no headings, tables, fences, or wiki-links. Script turns are formatted by the app; keep speaker names and wording intact.
${dialect}`,
      prompt,
      maxOutputTokens: 8000,
      temperature: 0.7,
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

const generatedPaperSchema = ieltsPaperFieldsSchema.extend({
  topic_slug: z.string().min(1),
  answer_key: z.string().min(1),
  script: z.string().optional(),
  lines: z
    .array(
      z.object({
        speaker: z.string().optional(),
        text: z.string().min(1),
      }),
    )
    .optional(),
});

export type GeneratedIeltsPaper = {
  paper: IeltsPaper;
  topicSlug: string;
  answerKey: string;
  script: string;
  lines: DialogueLine[];
};

function parseGeneratedPaper(raw: unknown): GeneratedIeltsPaper {
  const parsed = generatedPaperSchema.parse(raw);
  return {
    paper: normalizeIeltsPaper(parsed),
    topicSlug: parsed.topic_slug.trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, ""),
    answerKey: parsed.answer_key.trim(),
    script: parsed.script?.trim() || "",
    lines: parsed.lines ?? [],
  };
}

function topicsBlock(existingTopics: string[]): string {
  if (existingTopics.length === 0) return "No previous topics in this folder.";
  return `Do not reuse these topics: ${existingTopics.join(", ")}.`;
}

export async function generateReadingPaper(params: {
  variant: string;
  existingTopics: string[];
}): Promise<GeneratedIeltsPaper> {
  const variantHint =
    params.variant === "mini"
      ? "A short mini-set: one short notice or advert, 5–6 questions."
      : params.variant === "section-3"
        ? "General Training Reading Section 3: one longer general-interest passage, about 13–14 questions."
        : params.variant === "section-2"
          ? "General Training Reading Section 2: workplace texts, about 13–14 questions."
          : "General Training Reading Section 1: notices, adverts, timetables. About 13–14 questions.";
  const raw = await generateJson(
    `You write original IELTS General Training Reading practice. Not Cambridge copyright.
Return JSON only:
{"topic_slug":"kebab-case","title":"...","intro":"English passage(s) markdown","options":[{"label":"..."}],"questions":[{"n":"1","kind":"gap"|"choice","prompt":"...","heading":"...","placeholder":"...","options":[{"label":"..."}]}],"answer_key":"1. ...\\n2. ..."}
kind=gap for completion (use ____ in prompt). kind=choice for TRUE/FALSE/NOT GIVEN, matching, MCQ (options on the question or shared options bank).
Invent a NEW theme. Indicative practice only.`,
    `${variantHint}\n${topicsBlock(params.existingTopics)}`,
  );
  return parseGeneratedPaper(raw);
}

export async function generateWritingPaper(params: {
  variant: string;
  existingTopics: string[];
  previousMarkdown?: string;
}): Promise<GeneratedIeltsPaper> {
  const isRewrite = params.variant.startsWith("rewrite");
  const taskHint = isRewrite
    ? "Rewrite task: keep the same meaning as the previous piece. intro = instructions to rewrite more clearly in GT register. One question kind=long."
    : params.variant.startsWith("t1-")
      ? `IELTS GT Writing Task 1 letter (${params.variant.replace("t1-", "")}). Bullet points in the prompt. One question kind=long, placeholder with word count (150).`
      : `IELTS GT Writing Task 2 (${params.variant.replace("t2-", "")}). One essay prompt. kind=long, 250 words.`;
  const prev = params.previousMarkdown
    ? `\nPrevious piece:\n${params.previousMarkdown.slice(0, 6000)}`
    : "";
  const raw = await generateJson(
    `You write original IELTS General Training Writing prompts. Not Cambridge copyright.
Return JSON only:
{"topic_slug":"kebab-case","title":"...","intro":"English prompt","questions":[{"n":"1","kind":"long","prompt":"Write your response.","placeholder":"..."}],"answer_key":"Examiner notes / band expectations, not shown until grade."}
Invent a NEW theme. Indicative practice only.`,
    `${taskHint}\n${topicsBlock(params.existingTopics)}${prev}`,
  );
  return parseGeneratedPaper(raw);
}

const LISTENING_SECTION_HINT: Record<string, string> = {
  "section-1":
    "GT Listening Section 1 only: everyday conversation (booking, enquiry). Questions numbered 1–10. lines = spoken script.",
  "section-2":
    "GT Listening Section 2 only: one speaker, practical/public information (tour, facilities, workplace briefing). Questions numbered 11–20. lines = spoken script.",
  "section-3":
    "GT Listening Section 3 only: conversation in an education/training setting (two–four speakers). Questions numbered 21–30. lines = spoken script.",
  "section-4":
    "GT Listening Section 4 only: academic monologue / short lecture. Questions numbered 31–40. lines = spoken script.",
  "sections-1-4":
    "Full GT Listening: four sections in one script (conversation, monologue, education conversation, lecture). Questions 1–40 with headings Section 1 … Section 4. lines: all spoken lines in order, including short 'Now turn to section N' narrator lines between sections. One shared options bank if matching is used.",
};

export async function generateListeningPaper(params: {
  variant: string;
  existingTopics: string[];
}): Promise<GeneratedIeltsPaper> {
  const hint =
    LISTENING_SECTION_HINT[params.variant] ?? LISTENING_SECTION_HINT["section-1"]!;
  const raw = await generateJson(
    `You write original IELTS General Training Listening practice (script + questions). Not Cambridge copyright.
Return JSON only:
{"topic_slug":"kebab-case","title":"...","intro":"Exam instructions in English","options":[{"label":"..."}],"questions":[{"n":"1","kind":"gap"|"choice","prompt":"...","heading":"...","placeholder":"...","options":[{"label":"full wording of A"}]}],"answer_key":"1. ...","script":"Full transcript","lines":[{"speaker":"Name","text":"..."}]}
kind=choice MUST include per-question options with the full A/B/C wording in options[].label (not letter-only). Gaps use ____. Invent a NEW scenario. Indicative practice only.`,
    `${hint}\n${topicsBlock(params.existingTopics)}`,
  );
  const generated = parseGeneratedPaper(raw);
  if (generated.lines.length === 0) {
    throw new Error("Listening generation returned no audio lines.");
  }
  return generated;
}

const gradeSchema = z.object({
  correct: z.number(),
  total: z.number(),
  recap: z.string().min(1),
  items: z
    .array(
      z.object({
        n: z.string(),
        yours: z.string().optional(),
        correct: z.string().optional(),
        trap: z.string().optional(),
      }),
    )
    .optional(),
});

export type IeltsGradeResult = z.infer<typeof gradeSchema>;

export async function gradeIeltsPaper(params: {
  skill: IeltsSkill;
  paper: IeltsPaper;
  answers: IeltsPaperAnswerItem[];
  answerKey: string;
  script?: string;
}): Promise<IeltsGradeResult> {
  const native = usePrefsStore.getState().prefs.nativeLanguage;
  const nativeLabel = nativeLanguageLabel(native);
  const answers = params.answers
    .map((a) => {
      const q = params.paper.questions.find((item) => item.id === a.questionId);
      return `${a.n || q?.n}: ${a.value || "(blank)"}`;
    })
    .join("\n");
  const raw = await generateJson(
    `You grade IELTS General Training practice. Scores are indicative, not official Cambridge.
Write recap and trap notes in ${nativeLabel} (${native}). Keep English quotes, answers, and script as-is.
Return JSON only:
{"correct":0,"total":10,"recap":"...","items":[{"n":"1","yours":"...","correct":"...","trap":"..."}]}
Empty answers are misses. Be strict but fair.`,
    `Skill: ${params.skill}
Title: ${params.paper.title}
Answer key:\n${params.answerKey}
${params.script ? `Script:\n${params.script}\n` : ""}
Candidate answers:\n${answers}`,
  );
  return gradeSchema.parse(raw);
}

export function formatIeltsGradeMarkdown(params: {
  skill: IeltsSkill;
  paper: IeltsPaper;
  grade: IeltsGradeResult;
  answerKey: string;
  script?: string;
  lines?: DialogueLine[];
  audioWiki?: string;
}): string {
  const skillLabel = params.skill[0]!.toUpperCase() + params.skill.slice(1);
  const lines = [
    `# IELTS ${skillLabel}: ${params.paper.title}`,
    "",
    `**Indicative score:** ${params.grade.correct}/${params.grade.total}`,
    "",
    params.grade.recap,
    "",
  ];
  if (params.grade.items?.length) {
    lines.push("| Q | Yours | Correct | Trap |", "| --- | --- | --- | --- |");
    for (const item of params.grade.items) {
      lines.push(
        `| ${item.n} | ${item.yours ?? ""} | ${item.correct ?? ""} | ${item.trap ?? ""} |`,
      );
    }
    lines.push("");
  }
  if (params.audioWiki) {
    lines.push("## Audio", "", params.audioWiki, "");
  }
  const paperMd = formatIeltsPaperAsMarkdown(params.paper);
  if (paperMd) {
    lines.push("## Paper", "", paperMd, "");
  }
  lines.push("## Answer key", "", params.answerKey, "");
  const scriptMd = formatIeltsScriptMarkdown(params.script, params.lines);
  if (scriptMd) {
    lines.push("## Script", "", scriptMd, "");
  }
  return lines.join("\n");
}

export function formatIeltsScriptMarkdown(
  script?: string,
  lines?: DialogueLine[],
): string {
  const turns: DialogueLine[] =
    lines && lines.length > 0
      ? lines.filter((line) => line.text.trim())
      : parseScriptTurns(script ?? "");
  if (turns.length === 0) return (script ?? "").trim();
  return turns
    .map((turn) => {
      const who = (turn.speaker || "Speaker").trim();
      return `**${who}:** ${turn.text.trim()}`;
    })
    .join("\n\n");
}

function parseScriptTurns(script: string): DialogueLine[] {
  const raw = script.trim();
  if (!raw) return [];
  const out: DialogueLine[] = [];
  const lineRe = /^([A-Za-z][A-Za-z0-9 .'-]{0,40}):\s*(.*)$/;
  for (const line of raw.split(/\n+/)) {
    const m = lineRe.exec(line.trim());
    if (m) {
      out.push({ speaker: m[1]!.trim(), text: m[2]!.trim() });
    } else if (out.length > 0 && line.trim()) {
      const last = out[out.length - 1]!;
      last.text = `${last.text} ${line.trim()}`;
    }
  }
  return out;
}

export function defaultIeltsTimerSeconds(
  skill: IeltsSkill,
  variant: string,
): number {
  if (skill === "reading") return variant === "mini" ? 10 * 60 : 20 * 60;
  if (skill === "writing") {
    if (variant.startsWith("t2-")) return 40 * 60;
    return 20 * 60;
  }
  return 0;
}
