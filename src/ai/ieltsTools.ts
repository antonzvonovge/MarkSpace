import { tool } from "ai";
import { z } from "zod";
import {
  createNote,
  ensureFolder,
  joinPath,
  listTree,
  writeFileBytes,
  writeNote,
  type TreeNode,
} from "../lib/vaultApi";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { usePrefsStore } from "../store/prefsStore";
import { nativeLanguageLabel } from "../settings/types";
import { useVaultStore } from "../store/vaultStore";
import {
  clearIeltsSecret,
  getIeltsSecret,
  setIeltsSecret,
  useIeltsUiStore,
} from "../store/ieltsUiStore";
import { useSidebarUiStore } from "../store/sidebarUiStore";
import { synthesizeIeltsListening } from "./ieltsAudio";
import {
  resolveIeltsFolder,
  ieltsSessionFileStem,
  nestIeltsBundleFolder,
  ieltsSkillNeedsBundleFolder,
  topicsFromSessionFilenames,
} from "./ieltsDialogue";
import {
  IELTS_SKILLS,
  missingIeltsTtsMessage,
  pickIeltsTts,
} from "./ieltsFit";
import {
  normalizeIeltsPaper,
  waitForIeltsPaper,
  ieltsPaperFieldsSchema,
} from "./ieltsPaper";

function yieldToUi(): Promise<void> {
  return new Promise((r) => window.setTimeout(r, 0));
}

function findFolderNode(root: TreeNode, folderPath: string): TreeNode | null {
  const rel = folderPath.replace(/^\/+|\/+$/g, "");
  if (!rel) return root;
  let cur: TreeNode = root;
  for (const part of rel.split("/").filter(Boolean)) {
    const next = (cur.children ?? []).find((c) => c.isDir && c.name === part);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

const MAX_EXISTING_NOTES = 80;

async function listExistingSessionNotes(folder: string): Promise<string[]> {
  try {
    const root = await listTree();
    const node = findFolderNode(root, folder);
    if (!node) return [];
    const names: string[] = [];
    for (const child of node.children ?? []) {
      if (child.isDir) {
        if (/^\d{2}\.\d{2}\.\d{4}-/.test(child.name)) {
          names.push(`${child.name}.md`);
        }
        continue;
      }
      const lower = child.name.toLowerCase();
      if (!lower.endsWith(".md")) continue;
      if (child.name === ".folder.md") continue;
      names.push(child.name);
    }
    names.sort((a, b) => a.localeCompare(b));
    return names.slice(0, MAX_EXISTING_NOTES);
  } catch {
    return [];
  }
}

function activeThreadId(): string {
  const ui = useIeltsUiStore.getState();
  return ui.session?.threadId || ui.pendingThreadId || "default";
}

export function buildIeltsTools() {
  const resolveFolder = (raw: string | undefined) => {
    const session = useIeltsUiStore.getState().session;
    return resolveIeltsFolder(raw ?? session?.folder ?? "");
  };

  return {
    ielts_practice: tool({
      description:
        "Run an IELTS General Training practice session. After pick_vault_folder: start, set_secret, then show_paper. Listening: one synthesize_audio (full test = all four section scripts in that one call), then ONE show_paper (1–10 or 1–40). show_paper blocks until Submit; then immediately grade. Never four papers / four Submits. Do not call set_timer. After grade: save_note, end.",
      inputSchema: z
        .object({
        action: z
          .enum([
            "start",
            "set_secret",
            "set_timer",
            "synthesize_audio",
            "show_paper",
            "grade",
            "save_note",
            "end",
          ])
          .describe("Session step"),
        skill: z.enum(IELTS_SKILLS).optional(),
        folder: z
          .string()
          .optional()
          .describe("Vault-relative folder for the session note and audio"),
        variant: z
          .string()
          .optional()
          .describe("Short slug, e.g. t1-formal or section-2"),
        answer_key: z
          .string()
          .optional()
          .describe("Hidden answer key / examiner notes. Never repeat in chat before grade."),
        script: z
          .string()
          .optional()
          .describe("Hidden listening script. Reveal only after grade."),
        timer_seconds: z.number().int().min(0).max(3600).optional(),
        timer_label: z.string().optional(),
        lines: z
          .array(
            z.object({
              speaker: z.string().optional(),
              text: z.string().min(1),
            }),
          )
          .optional()
          .describe("Listening (or examiner) lines to synthesize"),
        markdown: z
          .string()
          .optional()
          .describe("Full session note markdown for save_note"),
        file_stem: z
          .string()
          .optional()
          .describe(
            "Optional topic slug without date (e.g. section-1-booking). save_note prefixes local dd.MM.YYYY-HH.mm.",
          ),
      })
      .merge(ieltsPaperFieldsSchema),
      execute: async (input, { toolCallId, abortSignal }) => {
        const threadId = activeThreadId();
        const settings = useAiSettingsStore.getState().settings;

        if (input.action === "start") {
          const skill = input.skill;
          const folder = resolveFolder(input.folder);
          if (!skill) {
            return { ok: false as const, error: "skill is required for start" };
          }
          if (!folder) {
            return {
              ok: false as const,
              error: "folder is required. Call pick_vault_folder first.",
            };
          }
          await ensureFolder(folder);
          const existing_notes = await listExistingSessionNotes(folder);
          const existing_topics = topicsFromSessionFilenames(existing_notes);
          useIeltsUiStore.getState().startSession({
            threadId,
            skill,
            folder,
            variant: input.variant?.trim() || skill,
            awaitingSubmit: true,
          });
          await yieldToUi();
          return {
            ok: true as const,
            action: "start",
            skill,
            folder,
            existing_notes,
            existing_topics,
            hint:
              existing_topics.length > 0
                ? `Do not print the answer key. Invent a NEW topic — do not reuse existing_topics (${existing_topics.join(", ")}). Call set_secret, then show the assignment only.`
                : "Do not print the answer key. Call set_secret, then show the assignment only.",
          };
        }

        if (input.action === "set_secret") {
          setIeltsSecret(threadId, {
            answerKey: input.answer_key?.trim() || "",
            script: input.script?.trim() || "",
          });
          await yieldToUi();
          return {
            ok: true as const,
            action: "set_secret",
            stored: true,
          };
        }

        if (input.action === "set_timer") {
          const seconds = input.timer_seconds ?? 0;
          useIeltsUiStore.getState().patch({
            timerLabel: input.timer_label?.trim() || "Timer",
            timerSeconds: seconds,
            timerEndsAt: seconds > 0 ? Date.now() + seconds * 1000 : null,
          });
          await yieldToUi();
          return { ok: true as const, action: "set_timer", seconds };
        }

        if (input.action === "show_paper") {
          const paper = normalizeIeltsPaper(input);
          if (paper.questions.length === 0) {
            await yieldToUi();
            return {
              ok: true as const,
              action: "show_paper",
              wait: false,
              answers: [] as { questionId: string; n: string; value: string }[],
            };
          }
          const submitted = await waitForIeltsPaper(toolCallId, abortSignal);
          return {
            ok: true as const,
            action: "show_paper",
            wait: true,
            answers: submitted.answers.map((a) => {
              const q = paper.questions.find((item) => item.id === a.questionId);
              const opt = q?.options.find((o) => o.id === a.value);
              return {
                questionId: a.questionId,
                n: a.n || q?.n || "",
                prompt: q?.prompt ?? "",
                value: a.value,
                label: opt?.label,
              };
            }),
          };
        }

        if (input.action === "synthesize_audio") {
          const session = useIeltsUiStore.getState().session;
          const folder = resolveFolder(input.folder || session?.folder);
          if (!folder) {
            return { ok: false as const, error: "No session folder. Call start first." };
          }
          if (!pickIeltsTts(settings)) {
            return { ok: false as const, error: missingIeltsTtsMessage() };
          }
          const lines = input.lines ?? [];
          if (lines.length === 0) {
            return { ok: false as const, error: "lines required" };
          }
          await ensureFolder(folder);
          let audio;
          try {
            audio = await synthesizeIeltsListening({ settings, lines });
          } catch (e) {
            return {
              ok: false as const,
              error: e instanceof Error ? e.message : "TTS failed",
            };
          }
          const stem = ieltsSessionFileStem(
            session?.variant || input.variant || "listening",
          );
          const dest = ieltsSkillNeedsBundleFolder(session?.skill)
            ? nestIeltsBundleFolder(folder, stem)
            : folder;
          await ensureFolder(dest);
          const path = joinPath(dest, audio.filename);
          const written = await writeFileBytes(path, audio.bytes);
          const paths = [written];
          useIeltsUiStore.getState().patch({
            folder: dest,
            audioPaths: paths,
            listeningPlaybackEnded: false,
          });
          await useVaultStore.getState().refreshTree();
          await yieldToUi();
          return {
            ok: true as const,
            action: "synthesize_audio",
            paths,
            folder: dest,
          };
        }

        if (input.action === "grade") {
          const secret = getIeltsSecret(threadId);
          const native = usePrefsStore.getState().prefs.nativeLanguage;
          await yieldToUi();
          return {
            ok: true as const,
            action: "grade",
            answer_key: secret?.answerKey || "(no key stored — compare as best you can)",
            script: secret?.script || "",
            indicative: true,
            native_language: native,
            native_language_label: nativeLanguageLabel(native),
            reply_in:
              "Write the score, explanations, traps, and feedback in this native language. Keep quoted English answers/script as-is.",
          };
        }

        if (input.action === "save_note") {
          const session = useIeltsUiStore.getState().session;
          const folder = resolveFolder(input.folder || session?.folder);
          if (!folder) {
            return { ok: false as const, error: "No folder for save_note" };
          }
          const md = input.markdown?.trim();
          if (!md) return { ok: false as const, error: "markdown required" };
          const stem = ieltsSessionFileStem(
            input.file_stem?.trim() ||
              `${session?.skill ?? "writing"}-${session?.variant ?? "practice"}`,
          );
          const dest = ieltsSkillNeedsBundleFolder(session?.skill)
            ? nestIeltsBundleFolder(folder, stem)
            : folder;
          await ensureFolder(dest);
          const path = joinPath(dest, `${stem}.md`);
          try {
            await createNote(path);
          } catch {
            /* exists */
          }
          await writeNote(path, md);
          await useVaultStore.getState().refreshTree();
          await useVaultStore.getState().openNote(path, { preview: false });
          useSidebarUiStore.getState().revealPathInTree(path);
          useIeltsUiStore.getState().patch({
            notePath: path,
            awaitingSubmit: false,
            folder: dest,
          });
          await yieldToUi();
          return { ok: true as const, action: "save_note", path };
        }

        if (input.action === "end") {
          clearIeltsSecret(threadId);
          useIeltsUiStore.getState().patch({ awaitingSubmit: false });
          await yieldToUi();
          return { ok: true as const, action: "end" };
        }

        return { ok: false as const, error: `Unknown action ${input.action}` };
      },
    }),
  };
}
