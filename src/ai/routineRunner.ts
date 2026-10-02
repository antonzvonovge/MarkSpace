import type { UIMessage } from "ai";
import { formatAiError, runChat } from "./runChat";
import {
  credentialsFromSettings,
  hasCredentialsForModel,
  missingCredentialsMessage,
} from "./languageModel";
import { modelSupportsReasoning } from "./models";
import { shouldUseReasoning } from "./shouldUseReasoning";
import { listSkills, loadSkills } from "./skills";
import { prepareUserMessageParts, type ChatAttachment } from "./chatAttachments";
import { contextWindowForModel, type ReasoningMode } from "./types";
import {
  extractSkillIdsFromDraft,
  extractToolIdsFromDraft,
  unwrapComposerMarkers,
} from "../lib/chatComposerDom";
import { collectChatFolderAbouts } from "../lib/folderContext";
import {
  completeRoutineRun,
  type Routine,
} from "../lib/routinesApi";
import {
  briefStateFromRoutine,
  loadBriefAttachment,
  routineMode,
  routineReasoning,
} from "../lib/routineBrief";
import { getProjectProperties } from "../lib/vaultApi";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { useRoutinesStore } from "../store/routinesStore";
import { useVaultStore } from "../store/vaultStore";
import { helperModelCallParams, vaultChatModelId, vaultWorkerModelId } from "../store/vaultAiSettingsStore";
import {
  WIDGET_SECTION_MISSING,
  widgetSectionFromMessages,
} from "./routineWidgetSection";

const inflight = new Set<string>();
const controllers = new Map<string, AbortController>();

function runKey(epoch: number, id: string): string {
  return `${epoch}:${id}`;
}

export function abortAllRoutineRuns(): void {
  for (const controller of controllers.values()) controller.abort();
}

export function kickRoutineRun(id: string, epoch: number): void {
  const key = runKey(epoch, id);
  if (inflight.has(key)) return;
  inflight.add(key);
  const controller = new AbortController();
  controllers.set(key, controller);
  void executeRoutineRun(id, epoch, controller).finally(() => {
    if (controllers.get(key) !== controller) return;
    inflight.delete(key);
    controllers.delete(key);
  });
}

async function resolveReasoning(opts: {
  mode: ReasoningMode;
  modelId: string;
  messages: UIMessage[];
  abortSignal: AbortSignal;
}): Promise<boolean> {
  if (!modelSupportsReasoning(opts.modelId) || opts.mode === "off") return false;
  if (opts.mode === "on") return true;
  const settings = useAiSettingsStore.getState().settings;
  return shouldUseReasoning({
    messages: opts.messages,
    keys: credentialsFromSettings(settings),
    ...helperModelCallParams(),
    abortSignal: opts.abortSignal,
  });
}

function assistantText(messages: UIMessage[]): string {
  const chunks: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part.type === "text" && part.text.trim()) chunks.push(part.text.trim());
    }
  }
  return chunks.join("\n\n").trim();
}

function askedTheUser(messages: UIMessage[]): boolean {
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type === "tool-ask_user") return true;
      if ("toolName" in part && part.toolName === "ask_user") return true;
    }
  }
  return false;
}

async function finish(
  id: string,
  epoch: number,
  signal: AbortSignal,
  status: "done" | "needs you" | "failed",
  body: string,
) {
  // Drop the in-flight guard before the scheduler emits the next start.
  inflight.delete(runKey(epoch, id));
  if (signal.aborted) return;
  try {
    await completeRoutineRun({ id, epoch, status, body });
  } catch {
    /* The scheduler already moved on (vault closed or the run was cancelled). */
  }
}

function currentRoutine(id: string): Routine | undefined {
  return useRoutinesStore.getState().routines.find((routine) => routine.id === id);
}

async function executeRoutineRun(
  id: string,
  epoch: number,
  controller: AbortController,
) {
  const routine = currentRoutine(id);
  if (!routine) {
    await finish(id, epoch, controller.signal, "failed", "This routine is no longer in the vault.");
    return;
  }
  const brief = briefStateFromRoutine(routine);
  const draft = brief.brief.trim();
  let attachments: ChatAttachment[] = [];
  if (brief.attachments.length > 0) {
    attachments = await Promise.all(brief.attachments.map((ref) => loadBriefAttachment(ref)));
  }
  if (controller.signal.aborted) return;
  const visible = unwrapComposerMarkers(draft).trim();
  if (!visible && attachments.length === 0) {
    await finish(id, epoch, controller.signal, "failed", "This routine has no brief.");
    return;
  }

  const settings = useAiSettingsStore.getState().settings;
  const modelId = brief.modelId.trim() || vaultChatModelId();
  const keys = credentialsFromSettings(settings);
  if (!hasCredentialsForModel(modelId, keys)) {
    await finish(
      id,
      epoch,
      controller.signal,
      "failed",
      missingCredentialsMessage(modelId, keys),
    );
    return;
  }

  const projectPath = brief.projectPath.trim() || null;
  let projectAbout = "";
  let projectType = "";
  let projectLearningLanguage = "";
  if (projectPath) {
    try {
      const props = await getProjectProperties(projectPath);
      projectAbout = props.about ?? "";
      projectType = props.projectType ?? "";
      projectLearningLanguage = props.learningLanguage ?? "";
    } catch {
      /* project context is optional */
    }
  }
  if (controller.signal.aborted) return;

  const { parts } = prepareUserMessageParts(draft, attachments);
  if (parts.length === 0) {
    await finish(id, epoch, controller.signal, "failed", "This routine has no brief.");
    return;
  }
  const messages: UIMessage[] = [
    { id: crypto.randomUUID(), role: "user", parts },
  ];
  const mode = routineMode(brief.mode);
  const reasoningMode = routineReasoning(brief.reasoningMode);
  let enableReasoning = false;
  try {
    enableReasoning = await resolveReasoning({
      mode: reasoningMode,
      modelId,
      messages,
      abortSignal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    await finish(id, epoch, controller.signal, "failed", formatAiError(err));
    return;
  }
  if (controller.signal.aborted) return;

  const skills = await listSkills().catch(() => []);
  const forcedSkills = await loadSkills(extractSkillIdsFromDraft(draft));
  const vault = useVaultStore.getState();
  let latest = messages;
  try {
    const result = await runChat({
      messages,
      mode,
      modelId,
      keys,
      vaultPath: vault.vaultPath,
      activePath: null,
      activeExcerpt: null,
      projectPath,
      projectAbout,
      folderContext: collectChatFolderAbouts({
        projectPath,
        composerText: draft,
        propsByPath: vault.projectPropertiesByPath,
      }),
      projectType,
      projectLearningLanguage,
      enableReasoning,
      skills,
      forcedSkills,
      forcedTools: extractToolIdsFromDraft(draft),
      specialistsUseChatModel: brief.specialistsUseChatModel,
      specialistModelId: brief.specialistModelId.trim() || vaultWorkerModelId(),
      contextWindow: contextWindowForModel(settings, modelId),
      maxSteps: settings.agentMaxSteps,
      abortSignal: controller.signal,
      terminalAutoAllow: mode === "agent",
      unattended: true,
      onMessages: (next) => {
        latest = next;
      },
    });
    latest = result.messages;
  } catch (err) {
    if (controller.signal.aborted) return;
    await finish(id, epoch, controller.signal, "failed", formatAiError(err));
    return;
  }
  if (controller.signal.aborted) return;

  const section = widgetSectionFromMessages(latest);
  const text = assistantText(latest);
  if (askedTheUser(latest)) {
    await finish(
      id,
      epoch,
      controller.signal,
      "needs you",
      section || text || "The run stopped because it needed a decision from you.",
    );
    return;
  }
  if (section) {
    await finish(id, epoch, controller.signal, "done", section);
    return;
  }
  if (!text) {
    await finish(id, epoch, controller.signal, "failed", "The run produced no reply.");
    return;
  }
  await finish(id, epoch, controller.signal, "done", WIDGET_SECTION_MISSING);
}
