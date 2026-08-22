import type { UIMessage } from "ai";
import { create } from "zustand";
import {
  fileToAttachment,
  mergeAttachments,
  prepareUserMessageParts,
  type ChatAttachment,
} from "../ai/chatAttachments";
import { generateChatTitle } from "../ai/generateChatTitle";
import { cancelAllPendingAskUser } from "../ai/askUser";
import { cancelAllPendingIeltsPaper } from "../ai/ieltsPaper";
import { cancelAllPendingPickVaultFolder } from "../ai/pickVaultFolder";
import {
  cancelAllPendingTerminal,
  killAllRunningTerminalJobs,
  setTerminalThreadAutoAllow,
} from "../ai/terminalTool";
import {
  buildContextAnchor,
  estimateUsedContext,
  wouldExceedContext,
} from "../ai/estimateTokens";
import {
  compactChatHistory,
  splitForCompaction,
} from "../ai/compactChatHistory";
import {
  credentialsFromSettings,
  hasCredentialsForModel,
  missingCredentialsMessage,
} from "../ai/languageModel";
import { pickIeltsTextModelId, missingIeltsTextKeyMessage } from "../ai/ieltsFit";
import { settleIncompleteToolCalls } from "../ai/incompleteToolCalls";
import { formatAiError, runChat } from "../ai/runChat";
import { resolveModelId } from "../ai/resolveModelId";
import { listSkills, loadSkills, type SkillMeta } from "../ai/skills";
import { buildSystemPrompt } from "../ai/vaultTools";
import { collectChatFolderAbouts, type FolderAbout } from "../lib/folderContext";
import { modelSupportsReasoning } from "../ai/models";
import { contextWindowForModel, type ChatMode } from "../ai/types";
import {
  deleteChatThread,
  getChatThread,
  listChatThreads,
  setOpenChatTabs,
  upsertChatThread,
  type ChatThreadMeta,
} from "../lib/chatHistoryApi";
import {
  groupPinnedTabs,
  keepForCloseOthers,
  keepForCloseToTheRight,
  reorderEditorTabs,
  setTabPinned as applyTabPinned,
  type PinnableTab,
} from "../lib/editorTabs";
import {
  extractSkillIdsFromDraft,
  extractToolIdsFromDraft,
  unwrapComposerMarkers,
} from "../lib/chatComposerDom";
import {
  expandSelectionMarkers,
  extractSelectionIds,
  parseUserTextSegments,
  truncateSelection,
  wrapSelectionMarker,
  type ChatSelectionRef,
} from "../lib/chatSelectionChips";
import {
  getProjectProperties,
  type ProjectTypeId,
} from "../lib/vaultApi";
import { getGem } from "../lib/gemsApi";
import { useAiSettingsStore } from "./aiSettingsStore";
import { useIeltsUiStore } from "./ieltsUiStore";
import {
  helperModelCallParams,
  vaultChatModelId,
} from "./vaultAiSettingsStore";
import { useVaultStore } from "./vaultStore";

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    return (message.parts ?? [])
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

function folderContextForChat(opts: {
  activePath: string | null;
  projectPath: string | null;
  composerText?: string | null;
}): FolderAbout[] {
  return collectChatFolderAbouts({
    activePath: opts.activePath,
    projectPath: opts.projectPath,
    composerText: opts.composerText,
    propsByPath: useVaultStore.getState().projectPropertiesByPath,
  });
}

export type ChatStatus = "ready" | "streaming" | "compacting" | "error";
export type { ChatAttachment };

export function isChatBusy(status: ChatStatus): boolean {
  return status === "streaming" || status === "compacting";
}

function titleFromMessage(text: string): string {
  // Prefer what the user typed; fall back to chips / quoted selection.
  const segments = parseUserTextSegments(text);
  const typed = segments
    .filter((s) => s.kind === "text")
    .map((s) => s.text)
    .join(" ");
  const chips = segments.flatMap((s) => {
    if (s.kind === "path") return [s.path];
    if (s.kind === "skill") return [`/${s.id}`];
    if (s.kind === "tool") return [`@${s.id}`];
    return [];
  });
  const selections = segments
    .filter((s) => s.kind === "selection")
    .map((s) => s.text);
  const source =
    [typed, ...chips].filter(Boolean).join(" ") ||
    selections.join(" ") ||
    unwrapComposerMarkers(text);
  const cleaned = source.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
}

function userText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/** True while title is still the default or a truncated first user message. */
function isProvisionalTitle(
  title: string | undefined,
  messages: UIMessage[],
  titleLocked?: boolean | null,
): boolean {
  if (titleLocked) return false;
  if (!title || title === "New chat") return true;
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return true;
  return title === titleFromMessage(userText(firstUser));
}

type ChatStore = {
  threads: ChatThreadMeta[];
  /** Ordered open chat tabs (may be empty). */
  openTabIds: string[];
  /** Pinned open chat tabs (subset of `openTabIds`). */
  pinnedTabIds: string[];
  activeThreadId: string | null;
  messages: UIMessage[];
  mode: ChatMode;
  modelId: string;
  /**
   * Sticky Reasoning toggle for this thread. Auto-on when picking a reasoning
   * model; user may turn it off. Forced off when the model has no reasoning.
   */
  enableReasoning: boolean;
  /**
   * Skip per-command terminal approval for this thread. Only effective while
   * Settings → Allow agent terminal is on.
   */
  terminalAllowForChat: boolean;
  projectPath: string | null;
  /** Cached "about" text for `projectPath` (for prompt + context meter). */
  projectAbout: string;
  /** Cached project type for `projectPath`. */
  projectType: ProjectTypeId;
  /** Cached learning language code when type is language learning. */
  projectLearningLanguage: string;
  /** Selected Gem id, or null for none. */
  gemId: string | null;
  /** Cached Gem name for system prompt. */
  gemName: string;
  /** Cached Gem instructions for system prompt. */
  gemInstructions: string;
  /** Cached Skills/ catalog for system prompt preview / context meter. */
  skillsCatalog: SkillMeta[];
  /**
   * Measured next-prompt baseline (empty draft) from the last API usage.
   * Null until a turn reports inputTokens (or heuristic fallback).
   */
  contextAnchorTokens: number | null;
  /** `messages.length` when `contextAnchorTokens` was set. */
  contextAnchorMessageCount: number | null;
  status: ChatStatus;
  error: string | null;
  draft: string;
  draftAttachments: ChatAttachment[];
  /** Text behind selection chips in the draft, keyed by chip id. */
  draftSelections: Record<string, ChatSelectionRef>;
  vaultBound: string | null;
  abort: AbortController | null;
  streamStartedAt: number | null;
  /** Live thinking text; updated without rewriting `messages`. */
  streamReasoningText: string | null;
  /**
   * Thread ids where the agent finished a turn while the user was not viewing
   * that tab. Cleared by typing, activating the tab, or focusing the composer.
   */
  attentionThreadIds: string[];
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setDraft: (draft: string) => void;
  /** Append a selection chip to the draft; returns its chip id. */
  addSelectionToDraft: (text: string, sourcePath: string | null) => string;
  /** Add a note comment as a chat chip (quote + body + note path). */
  addCommentToDraft: (input: {
    quote: string;
    body: string;
    sourcePath: string;
  }) => string;
  clearThreadAttention: (threadId: string) => void;
  addAttachments: (files: File[]) => Promise<string[]>;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setMode: (mode: ChatMode) => void;
  setModelId: (modelId: string) => void;
  setEnableReasoning: (enableReasoning: boolean) => void;
  setTerminalAllowForChat: (allow: boolean) => void;
  setProjectPath: (projectPath: string | null) => Promise<void>;
  /** Start a new chat thread with the given Gem (model + instructions). */
  newThreadWithGem: (gemId: string) => Promise<void>;
  /** Drop Gem from the active thread (e.g. after the Gem was deleted). */
  clearActiveGem: () => Promise<void>;
  /** Refresh gem name/instructions cache after edit; clear if deleted. */
  refreshActiveGem: () => Promise<void>;
  refreshSkillsCatalog: () => Promise<SkillMeta[]>;
  /** Start a new chat; optional `projectPath` / `mode` override defaults. */
  newThread: (opts?: {
    projectPath?: string | null;
    mode?: ChatMode;
  }) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  closeTab: (threadId: string) => Promise<void>;
  closeOtherTabs: (threadId: string) => Promise<void>;
  closeTabsToTheRight: (threadId: string) => Promise<void>;
  reorderOpenTabs: (fromIndex: number, toIndex: number) => Promise<void>;
  setTabPinned: (threadId: string, pinned: boolean) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  /** Set a user-chosen title; further auto-rename is skipped. */
  renameThread: (threadId: string, title: string) => Promise<void>;
  send: (text?: string) => Promise<void>;
  /** Drop replies after this user turn and regenerate the assistant response. */
  retryFromUserMessage: (messageId: string) => Promise<void>;
  stop: () => void;
  clearError: () => void;
  persistActive: () => Promise<void>;
  systemPromptPreview: () => string;
};

function defaultsFromSettings(): {
  mode: ChatMode;
  modelId: string;
  enableReasoning: boolean;
} {
  const s = useAiSettingsStore.getState().settings;
  const modelId = vaultChatModelId();
  return {
    mode: s.defaultMode,
    modelId,
    enableReasoning: modelSupportsReasoning(modelId),
  };
}

function DEFAULT_MODEL_PLACEHOLDER(): string {
  try {
    return vaultChatModelId();
  } catch {
    return "anthropic/claude-sonnet-5";
  }
}

function emptySession(vaultBound: string | null = null) {
  return {
    vaultBound,
    threads: [] as ChatThreadMeta[],
    openTabIds: [] as string[],
    pinnedTabIds: [] as string[],
    activeThreadId: null as string | null,
    messages: [] as UIMessage[],
    status: "ready" as ChatStatus,
    error: null as string | null,
    abort: null as AbortController | null,
    streamStartedAt: null as number | null,
    streamReasoningText: null as string | null,
    attentionThreadIds: [] as string[],
    draft: "",
    draftAttachments: [] as ChatAttachment[],
    draftSelections: {} as Record<string, ChatSelectionRef>,
    projectPath: null as string | null,
    projectAbout: "",
    projectType: "" as ProjectTypeId,
    projectLearningLanguage: "",
    gemId: null as string | null,
    gemName: "",
    gemInstructions: "",
    skillsCatalog: [] as SkillMeta[],
    contextAnchorTokens: null as number | null,
    contextAnchorMessageCount: null as number | null,
    terminalAllowForChat: false,
    ...defaultsFromSettings(),
  };
}

function applyListedTabs(listed: {
  openTabIds: string[];
  pinnedTabIds?: string[];
}): { openTabIds: string[]; pinnedTabIds: string[] } {
  const pinned = new Set(listed.pinnedTabIds ?? []);
  const grouped = groupPinnedTabs(
    listed.openTabIds.map((path) => ({ path, pinned: pinned.has(path) })),
  );
  return {
    openTabIds: grouped.map((t) => t.path),
    pinnedTabIds: grouped.filter((t) => t.pinned).map((t) => t.path),
  };
}

function chatPinnableTabs(
  openTabIds: string[],
  pinnedTabIds: string[],
): PinnableTab[] {
  const pinned = new Set(pinnedTabIds);
  return openTabIds.map((path) => ({ path, pinned: pinned.has(path) }));
}

async function persistChatTabs(
  get: () => ChatStore,
  openTabIds: string[],
  activeThreadId: string | null,
  pinnedTabIds?: string[],
) {
  const vaultPath =
    get().vaultBound ?? useVaultStore.getState().vaultPath;
  if (!vaultPath) return null;
  const pinned = (pinnedTabIds ?? get().pinnedTabIds).filter((id) =>
    openTabIds.includes(id),
  );
  return setOpenChatTabs(vaultPath, openTabIds, activeThreadId, pinned);
}

const STREAM_PERSIST_MS = 2000;
let persistActiveChain: Promise<void> = Promise.resolve();
let lastStreamPersistAt = 0;

async function writeActiveThread(get: () => ChatStore): Promise<void> {
  const {
    vaultBound,
    activeThreadId,
    messages,
    mode,
    modelId,
    projectPath,
    gemId,
    enableReasoning,
    terminalAllowForChat,
    contextAnchorTokens,
    contextAnchorMessageCount,
    threads,
  } = get();
  if (!vaultBound || !activeThreadId) return;
  const meta = threads.find((t) => t.id === activeThreadId);
  const now = Date.now();
  const title =
    meta?.title && !isProvisionalTitle(meta.title, messages, meta.titleLocked)
      ? meta.title
      : (() => {
          const firstUser = messages.find((m) => m.role === "user");
          return firstUser
            ? titleFromMessage(userText(firstUser))
            : meta?.title && meta.title !== "New chat"
              ? meta.title
              : "New chat";
        })();
  const file = {
    id: activeThreadId,
    title,
    createdAt: meta?.createdAt ?? now,
    updatedAt: now,
    mode,
    modelId,
    projectPath,
    gemId,
    enableReasoning,
    terminalAllowForChat,
    contextAnchorTokens,
    contextAnchorMessageCount,
    messages,
    ...(meta?.titleLocked ? { titleLocked: true as const } : {}),
  };
  const updated = await upsertChatThread(vaultBound, file);
  useChatStore.setState((s) => ({
    threads: [
      updated,
      ...s.threads.filter((t) => t.id !== updated.id),
    ].sort((a, b) => b.updatedAt - a.updatedAt),
  }));
}

function enqueuePersistActive(get: () => ChatStore): Promise<void> {
  persistActiveChain = persistActiveChain.then(
    () => writeActiveThread(get),
    () => writeActiveThread(get),
  );
  return persistActiveChain;
}

/** Drop selection texts whose chip was deleted from the draft. */
function pruneSelections(
  selections: Record<string, ChatSelectionRef>,
  draft: string,
): Record<string, ChatSelectionRef> {
  const ids = extractSelectionIds(draft);
  const keys = Object.keys(selections);
  if (keys.length === ids.length && keys.every((id) => ids.includes(id))) {
    return selections;
  }
  const next: Record<string, ChatSelectionRef> = {};
  for (const id of ids) {
    const ref = selections[id];
    if (ref) next[id] = ref;
  }
  return next;
}

function withAttention(ids: string[], threadId: string): string[] {
  return ids.includes(threadId) ? ids : [...ids, threadId];
}

function withoutAttention(ids: string[], threadId: string): string[] {
  return ids.includes(threadId) ? ids.filter((id) => id !== threadId) : ids;
}

/** True when the thread has no messages (draft-only / never sent). */
async function isThreadEmpty(
  vaultPath: string,
  threadId: string,
  get: () => ChatStore,
): Promise<boolean> {
  if (get().activeThreadId === threadId) {
    return get().messages.length === 0;
  }
  try {
    const file = await getChatThread(vaultPath, threadId);
    return !Array.isArray(file.messages) || file.messages.length === 0;
  } catch {
    // Missing file — treat as empty so it can be scrubbed from the index.
    return true;
  }
}

/** Delete closed tabs that never got a message (keep them out of history). */
async function deleteEmptyClosedThreads(
  vaultPath: string,
  closedIds: string[],
  get: () => ChatStore,
): Promise<void> {
  for (const id of closedIds) {
    if (await isThreadEmpty(vaultPath, id, get)) {
      await deleteChatThread(vaultPath, id);
    }
  }
}

type ProjectContext = {
  about: string;
  projectType: ProjectTypeId;
  learningLanguage: string;
};

type GemContext = {
  gemId: string | null;
  gemName: string;
  gemInstructions: string;
  enableReasoning: boolean;
  /** Model from the gem when found; null if none / missing. */
  modelId: string | null;
};

const EMPTY_PROJECT_CONTEXT: ProjectContext = {
  about: "",
  projectType: "",
  learningLanguage: "",
};

const EMPTY_GEM_CONTEXT: GemContext = {
  gemId: null,
  gemName: "",
  gemInstructions: "",
  enableReasoning: true,
  modelId: null,
};

async function loadProjectContext(
  projectPath: string | null,
): Promise<ProjectContext> {
  if (!projectPath) return EMPTY_PROJECT_CONTEXT;
  try {
    const props = await getProjectProperties(projectPath);
    return {
      about: props.about ?? "",
      projectType: props.projectType ?? "",
      learningLanguage: props.learningLanguage ?? "",
    };
  } catch {
    return EMPTY_PROJECT_CONTEXT;
  }
}

async function loadGemContext(gemId: string | null): Promise<GemContext> {
  const id = gemId?.trim() || null;
  if (!id) return EMPTY_GEM_CONTEXT;
  try {
    const gem = await getGem(id);
    return {
      gemId: gem.id,
      gemName: gem.name,
      gemInstructions: gem.instructions,
      enableReasoning: gem.enableReasoning !== false,
      modelId: gem.modelId,
    };
  } catch {
    return EMPTY_GEM_CONTEXT;
  }
}

type ChatStoreGet = () => ChatStore;
type ChatStoreSet = (
  partial:
    | Partial<ChatStore>
    | ((state: ChatStore) => Partial<ChatStore>),
) => void;

/** Create a new chat tab. Project is inherited; Gem only when `gemId` is passed. */
async function createNewThread(
  get: ChatStoreGet,
  set: ChatStoreSet,
  gemId: string | null,
  opts?: { projectPath?: string | null; mode?: ChatMode },
): Promise<void> {
  const vaultPath = get().vaultBound ?? useVaultStore.getState().vaultPath;
  if (!vaultPath) return;
  if (isChatBusy(get().status)) get().stop();
  const defaults = defaultsFromSettings();
  const mode = opts?.mode ?? defaults.mode;
  const defaultModelId = defaults.modelId;
  const now = Date.now();
  const id = crypto.randomUUID();
  // Explicit project wins; else inherit from the chat the user was just in,
  // else the latest thread that has a project.
  const inheritedProject =
    opts && "projectPath" in opts
      ? opts.projectPath?.trim() || null
      : get().projectPath?.trim() ||
        [...get().threads]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((t) => t.projectPath?.trim() || null)
          .find((p): p is string => !!p) ||
        null;
  const project = await loadProjectContext(inheritedProject);
  const gem = await loadGemContext(gemId);
  const settings = useAiSettingsStore.getState().settings;
  const modelId = gem.modelId
    ? resolveModelId(settings.baseUrl, gem.modelId)
    : defaultModelId;
  const supports = modelSupportsReasoning(modelId);
  const enableReasoning = gem.gemId
    ? supports && gem.enableReasoning
    : supports;
  const empty = {
    id,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    mode,
    modelId,
    projectPath: inheritedProject,
    gemId: gem.gemId,
    enableReasoning,
    terminalAllowForChat: false,
    messages: [] as UIMessage[],
  };
  setTerminalThreadAutoAllow(false);
  const meta = await upsertChatThread(vaultPath, empty);
  const openTabIds = [...get().openTabIds.filter((t) => t !== id), id];
  await persistChatTabs(get, openTabIds, id);
  const listed = await listChatThreads(vaultPath);
  set({
    vaultBound: vaultPath,
    threads: listed.threads,
    ...applyListedTabs(listed),
    activeThreadId: id,
    messages: [],
    mode: meta.mode === "agent" ? "agent" : "ask",
    modelId: meta.modelId || modelId,
    enableReasoning,
    terminalAllowForChat: false,
    projectPath: inheritedProject,
    projectAbout: project.about,
    projectType: project.projectType,
    projectLearningLanguage: project.learningLanguage,
    gemId: gem.gemId,
    gemName: gem.gemName,
    gemInstructions: gem.gemInstructions,
    contextAnchorTokens: null,
    contextAnchorMessageCount: null,
    status: "ready",
    error: null,
    draft: "",
    draftAttachments: [],
    streamStartedAt: null,
  });
}

async function loadThreadIntoState(
  vaultPath: string,
  threadId: string,
  threads: ChatThreadMeta[],
  openTabIds: string[],
  pinnedTabIds?: string[],
) {
  const { modelId } = defaultsFromSettings();
  const baseUrl = useAiSettingsStore.getState().settings.baseUrl;
  const thread = await getChatThread(vaultPath, threadId);
  const projectPath = thread.projectPath?.trim() || null;
  const project = await loadProjectContext(projectPath);
  const gem = await loadGemContext(thread.gemId?.trim() || null);
  const anchorTokens =
    typeof thread.contextAnchorTokens === "number" &&
    thread.contextAnchorTokens > 0
      ? thread.contextAnchorTokens
      : null;
  const anchorCount =
    typeof thread.contextAnchorMessageCount === "number" &&
    thread.contextAnchorMessageCount >= 0
      ? thread.contextAnchorMessageCount
      : null;
  const resolvedModelId = resolveModelId(baseUrl, thread.modelId || modelId);
  const supports = modelSupportsReasoning(resolvedModelId);
  const enableReasoning =
    typeof thread.enableReasoning === "boolean"
      ? thread.enableReasoning && supports
      : supports;
  const terminalAllowForChat = thread.terminalAllowForChat === true;
  setTerminalThreadAutoAllow(terminalAllowForChat);
  const rawMessages = Array.isArray(thread.messages) ? thread.messages : [];
  const messages = settleIncompleteToolCalls(rawMessages);
  if (messages !== rawMessages) {
    void upsertChatThread(vaultPath, { ...thread, messages });
  }
  const tabs = applyListedTabs({ openTabIds, pinnedTabIds });
  return {
    vaultBound: vaultPath,
    threads,
    openTabIds: tabs.openTabIds,
    pinnedTabIds: tabs.pinnedTabIds,
    activeThreadId: threadId,
    messages,
    mode: thread.mode === "agent" ? ("agent" as const) : ("ask" as const),
    modelId: resolvedModelId,
    enableReasoning,
    terminalAllowForChat,
    projectPath,
    projectAbout: project.about,
    projectType: project.projectType,
    projectLearningLanguage: project.learningLanguage,
    gemId: gem.gemId,
    gemName: gem.gemName,
    gemInstructions: gem.gemInstructions,
    contextAnchorTokens: anchorTokens,
    contextAnchorMessageCount:
      anchorTokens != null ? anchorCount : null,
    status: "ready" as const,
    error: null,
    abort: null,
    streamStartedAt: null,
    streamReasoningText: null,
  };
}

/** Close every open chat tab whose id is not in `keepIds`. */
async function closeChatTabsKeeping(
  get: () => ChatStore,
  set: (
    partial:
      | Partial<ChatStore>
      | ((state: ChatStore) => Partial<ChatStore>),
  ) => void,
  keepIds: Set<string>,
): Promise<void> {
  const vaultPath = get().vaultBound;
  if (!vaultPath) return;

  const prevTabs = get().openTabIds;
  const openTabIds = prevTabs.filter((id) => keepIds.has(id));
  if (openTabIds.length === prevTabs.length) return;

  const currentActive = get().activeThreadId;
  const closingActive =
    currentActive != null && !keepIds.has(currentActive);

  if (closingActive && isChatBusy(get().status)) {
    get().stop();
  }

  const nextActive = closingActive
    ? (openTabIds[openTabIds.length - 1] ?? null)
    : currentActive && openTabIds.includes(currentActive)
      ? currentActive
      : openTabIds[0] ?? null;

  const closedIds = prevTabs.filter((id) => !keepIds.has(id));
  // Empty chats must not linger in history after the tab is closed.
  await deleteEmptyClosedThreads(vaultPath, closedIds, get);
  const listed = await persistChatTabs(get, openTabIds, nextActive);
  if (!listed) return;

  let attention = get().attentionThreadIds;
  for (const id of closedIds) {
    attention = withoutAttention(attention, id);
  }

  if (!nextActive) {
    set({
      threads: listed.threads,
      ...applyListedTabs(listed),
      activeThreadId: null,
      messages: [],
      status: "ready",
      error: null,
      draft: "",
      draftAttachments: [],
      streamStartedAt: null,
      attentionThreadIds: attention,
      ...defaultsFromSettings(),
    });
    return;
  }

  const tabs = applyListedTabs(listed);
  if (closingActive) {
    set(
      await loadThreadIntoState(
        vaultPath,
        nextActive,
        listed.threads,
        tabs.openTabIds,
        tabs.pinnedTabIds,
      ),
    );
    set({
      draft: "",
      draftAttachments: [],
      attentionThreadIds: withoutAttention(attention, nextActive),
    });
  } else {
    set({
      threads: listed.threads,
      ...tabs,
      activeThreadId: listed.activeThreadId,
      attentionThreadIds: attention,
    });
  }
}

/**
 * Compact if needed, then stream an assistant reply for `messages`
 * (must already end with the user turn being answered).
 */
async function runAssistantTurn(params: {
  messages: UIMessage[];
  skillIds: string[];
  toolIds: string[];
  clearDraft: boolean;
  titleHint?: string;
  /** History used for context estimate before compaction (defaults to messages). */
  estimateHistory?: UIMessage[];
  estimateDraft?: string;
  estimateAttachments?: ChatAttachment[];
}): Promise<void> {
  const get = useChatStore.getState;
  const set = useChatStore.setState;

  const vaultPath =
    get().vaultBound ?? useVaultStore.getState().vaultPath;
  if (!vaultPath) {
    set({ error: "Open a vault to chat", status: "error" });
    return;
  }

  const settings = useAiSettingsStore.getState().settings;
  const keys = credentialsFromSettings(settings);
  const ieltsSession = useIeltsUiStore.getState().session;
  const wantsIelts =
    params.skillIds.some((id) => id.startsWith("ielts-")) ||
    (ieltsSession != null && ieltsSession.threadId === get().activeThreadId) ||
    /\bielts\b/i.test(lastUserText(params.messages));
  const ieltsModel = wantsIelts ? pickIeltsTextModelId(settings) : null;
  if (wantsIelts && !ieltsModel) {
    set({
      error: missingIeltsTextKeyMessage(),
      status: "error",
    });
    return;
  }
  const modelId = resolveModelId(
    settings.baseUrl,
    ieltsModel || get().modelId || vaultChatModelId(),
  );
  if (!hasCredentialsForModel(modelId, keys)) {
    set({
      error: missingCredentialsMessage(modelId, keys),
      status: "error",
    });
    return;
  }

  if (isChatBusy(get().status)) return;

  let activeThreadId = get().activeThreadId;
  if (!activeThreadId) {
    await get().newThread();
    activeThreadId = get().activeThreadId;
  }
  if (!activeThreadId) return;

  const vault = useVaultStore.getState();
  const excerpt =
    vault.activePath && vault.content
      ? vault.content.slice(0, 4000)
      : null;

  const projectPath = get().projectPath;
  const project = projectPath
    ? await loadProjectContext(projectPath)
    : EMPTY_PROJECT_CONTEXT;
  if (projectPath) {
    set({
      projectAbout: project.about,
      projectType: project.projectType,
      projectLearningLanguage: project.learningLanguage,
    });
  }

  const skills = await get().refreshSkillsCatalog();
  const forcedSkills = params.skillIds.length
    ? await loadSkills(params.skillIds)
    : [];
  const forcedTools = params.toolIds.length ? params.toolIds : [];
  const mode = get().mode;
  const limit = contextWindowForModel(settings, modelId);
  const folderContext = folderContextForChat({
    activePath: vault.activePath,
    projectPath,
    composerText: lastUserText(params.messages) || params.estimateDraft || "",
  });
  const system = buildSystemPrompt({
    mode,
    vaultPath,
    activePath: vault.activePath,
    activeExcerpt: excerpt,
    projectPath,
    projectAbout: project.about,
    folderContext,
    projectType: project.projectType,
    projectLearningLanguage: project.learningLanguage,
    gemName: get().gemName,
    gemInstructions: get().gemInstructions,
    skills,
    forcedSkills,
    forcedTools,
  });
  const anchorTokens = get().contextAnchorTokens;
  const anchorCount = get().contextAnchorMessageCount;

  let history = params.estimateHistory ?? params.messages;
  const estimateDraft = params.estimateDraft ?? "";
  const estimateAttachments = params.estimateAttachments ?? [];
  let usedBeforeSend = estimateUsedContext({
    system,
    messages: history,
    draft: estimateDraft,
    draftAttachments: estimateAttachments,
    mode,
    anchor:
      anchorTokens != null && anchorCount != null
        ? { tokens: anchorTokens, messageCount: anchorCount }
        : null,
  });

  const controller = new AbortController();

  if (wouldExceedContext(usedBeforeSend, limit)) {
    const { older } = splitForCompaction(history);
    if (older.length === 0) {
      set({
        error:
          "Context window is full and there is nothing older to compact. Start a new chat.",
        status: "error",
      });
      return;
    }

    set({
      abort: controller,
      status: "compacting",
      error: null,
      streamStartedAt: Date.now(),
      streamReasoningText: null,
    });

    try {
      const { messages: compacted, compacted: didCompact } =
        await compactChatHistory({
          messages: history,
          keys,
          ...helperModelCallParams(),
          abortSignal: controller.signal,
        });
      if (!didCompact) {
        set({
          abort: null,
          status: "error",
          streamStartedAt: null,
          error:
            "Context window is full and there is nothing older to compact. Start a new chat.",
        });
        return;
      }
      history = compacted;
      // Rebuild turn messages: compacted prefix + trailing user turn when
      // estimateHistory was a prefix of params.messages.
      const trailing = params.messages.slice(
        (params.estimateHistory ?? params.messages).length,
      );
      const nextMessages =
        trailing.length > 0 ? [...history, ...trailing] : history;
      set({
        messages: nextMessages,
        contextAnchorTokens: null,
        contextAnchorMessageCount: null,
      });
      params = { ...params, messages: nextMessages };
      usedBeforeSend = estimateUsedContext({
        system,
        messages: history,
        draft: estimateDraft,
        draftAttachments: estimateAttachments,
        mode,
        anchor: null,
      });
      if (wouldExceedContext(usedBeforeSend, limit)) {
        set({
          abort: null,
          status: "error",
          streamStartedAt: null,
          error:
            "Context is still full after compaction. Start a new chat or shorten your message.",
        });
        await get().persistActive();
        return;
      }
      await get().persistActive();
    } catch (e) {
      const aborted =
        controller.signal.aborted ||
        (e instanceof Error && e.name === "AbortError");
      if (aborted) {
        set({
          status: "ready",
          abort: null,
          streamStartedAt: null,
          streamReasoningText: null,
        });
        return;
      }
      set({
        abort: null,
        status: "error",
        streamStartedAt: null,
        error: formatAiError(e),
      });
      return;
    }
  }

  const messages = params.messages;
  const prevMeta = get().threads.find((t) => t.id === activeThreadId);
  const provisional = isProvisionalTitle(
    prevMeta?.title,
    messages,
    prevMeta?.titleLocked,
  );
  const firstUser = messages.find((m) => m.role === "user");
  const title = provisional
    ? firstUser
      ? titleFromMessage(userText(firstUser) || params.titleHint || "")
      : "New chat"
    : (prevMeta?.title ?? "New chat");

  set({
    messages,
    ...(params.clearDraft
      ? {
          draft: "",
          draftAttachments: [],
          draftSelections: {},
        }
      : {}),
    status: "streaming",
    error: null,
    streamStartedAt: Date.now(),
    streamReasoningText: null,
    abort: controller,
    threads: get().threads.map((t) =>
      t.id === activeThreadId ? { ...t, title, updatedAt: Date.now() } : t,
    ),
  });
  lastStreamPersistAt = Date.now();
  void get().persistActive();

  try {
    const { messages: finalMessages, lastStepInputTokens } = await runChat({
      messages,
      mode,
      modelId,
      keys,
      vaultPath,
      activePath: vault.activePath,
      activeExcerpt: excerpt,
      projectPath,
      projectAbout: project.about,
      folderContext,
      projectType: project.projectType,
      projectLearningLanguage: project.learningLanguage,
      gemName: get().gemName,
      gemInstructions: get().gemInstructions,
      enableReasoning: get().enableReasoning,
      skills,
      forcedSkills,
      forcedTools,
      contextWindow: limit,
      maxSteps: settings.agentMaxSteps,
      abortSignal: controller.signal,
      onMessages: (next) => {
        if (get().abort !== controller) return;
        set({ messages: next });
        const now = Date.now();
        const incomplete = next.some((m) =>
          (m.parts ?? []).some((p) => {
            if (!("state" in p)) return false;
            const st = String((p as { state?: string }).state);
            return (
              st === "input-available" ||
              st === "input-streaming" ||
              st === "approval-requested"
            );
          }),
        );
        if (incomplete || now - lastStreamPersistAt >= STREAM_PERSIST_MS) {
          lastStreamPersistAt = now;
          void get().persistActive();
        }
      },
      onReasoningPreview: (text) => {
        if (get().abort !== controller) return;
        set({ streamReasoningText: text });
      },
    });
    const anchor = buildContextAnchor({
      lastStepInputTokens,
      messages: finalMessages,
      system,
      mode,
    });
    const viewingFinished = get().activeThreadId === activeThreadId;
    set({
      messages: finalMessages,
      contextAnchorTokens: anchor.tokens,
      contextAnchorMessageCount: anchor.messageCount,
      status: "ready",
      abort: null,
      streamStartedAt: null,
      streamReasoningText: null,
      error: null,
      attentionThreadIds: viewingFinished
        ? withoutAttention(get().attentionThreadIds, activeThreadId)
        : withAttention(get().attentionThreadIds, activeThreadId),
    });
    await get().persistActive();
    await maybeRefreshTitle(activeThreadId, finalMessages, {
      keys,
      modelId,
    });
  } catch (e) {
    const aborted =
      controller.signal.aborted ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      set({
        status: "ready",
        abort: null,
        streamStartedAt: null,
        streamReasoningText: null,
      });
      await get().persistActive();
      return;
    }
    const message = formatAiError(e);
    const errorMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [{ type: "text", text: `Error: ${message}` }],
    };
    const base = get().messages;
    const withoutEmptyAssistant =
      base.length > 0 &&
      base[base.length - 1]?.role === "assistant" &&
      !(base[base.length - 1].parts ?? []).some(
        (p) =>
          (p.type === "text" && p.text.trim()) ||
          ("type" in p && String(p.type).startsWith("tool-")),
      )
        ? base.slice(0, -1)
        : base;
    const next = [...withoutEmptyAssistant, errorMsg];
    const viewingFinished = get().activeThreadId === activeThreadId;
    set({
      messages: next,
      status: "error",
      error: message,
      abort: null,
      streamStartedAt: null,
      streamReasoningText: null,
      attentionThreadIds: viewingFinished
        ? withoutAttention(get().attentionThreadIds, activeThreadId)
        : withAttention(get().attentionThreadIds, activeThreadId),
    });
    await get().persistActive();
  }
}

/** Replace provisional title with a short LLM-generated name (best-effort). */
async function maybeRefreshTitle(
  threadId: string,
  messages: UIMessage[],
  api: {
    keys: ReturnType<typeof credentialsFromSettings>;
    modelId: string;
  },
) {
  const state = useChatStore.getState();
  const meta = state.threads.find((t) => t.id === threadId);
  if (!meta || !isProvisionalTitle(meta.title, messages, meta.titleLocked)) return;

  const title = await generateChatTitle({
    messages,
    keys: api.keys,
    ...helperModelCallParams(),
  });
  if (!title) return;

  const latest = useChatStore.getState();
  const latestMeta = latest.threads.find((t) => t.id === threadId);
  if (!latestMeta || !isProvisionalTitle(latestMeta.title, messages, latestMeta.titleLocked)) return;

  const vaultPath = latest.vaultBound;
  if (!vaultPath) return;

  const now = Date.now();
  useChatStore.setState({
    threads: latest.threads.map((t) =>
      t.id === threadId ? { ...t, title, updatedAt: now } : t,
    ),
  });

  if (latest.activeThreadId === threadId) {
    await useChatStore.getState().persistActive();
    return;
  }

  // Thread is open in background — persist title without touching active messages.
  try {
    const file = await getChatThread(vaultPath, threadId);
    await upsertChatThread(vaultPath, { ...file, title, updatedAt: now });
    const listed = await listChatThreads(vaultPath);
    useChatStore.setState({
      threads: listed.threads,
      ...applyListedTabs(listed),
    });
  } catch {
    /* best-effort */
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  threads: [],
  openTabIds: [],
  pinnedTabIds: [],
  activeThreadId: null,
  messages: [],
  mode: "ask",
  modelId: DEFAULT_MODEL_PLACEHOLDER(),
  enableReasoning: modelSupportsReasoning(DEFAULT_MODEL_PLACEHOLDER()),
  terminalAllowForChat: false,
  projectPath: null,
  projectAbout: "",
  projectType: "",
  projectLearningLanguage: "",
  gemId: null,
  gemName: "",
  gemInstructions: "",
  skillsCatalog: [],
  contextAnchorTokens: null,
  contextAnchorMessageCount: null,
  status: "ready",
  error: null,
  draft: "",
  draftAttachments: [],
  draftSelections: {},
  vaultBound: null,
  abort: null,
  streamStartedAt: null,
  streamReasoningText: null,
  attentionThreadIds: [],

  hydrateForVault: async (vaultPath) => {
    const prev = get().abort;
    if (prev) prev.abort();
    if (!vaultPath) {
      setTerminalThreadAutoAllow(false);
      set(emptySession(null));
      return;
    }
    try {
      const listed = await listChatThreads(vaultPath);
      const tabs = applyListedTabs(listed);
      const openIds = tabs.openTabIds.filter((id) =>
        listed.threads.some((t) => t.id === id),
      );
      const active =
        listed.activeThreadId && openIds.includes(listed.activeThreadId)
          ? listed.activeThreadId
          : openIds[0] ?? null;

      if (active) {
        try {
          set(
            await loadThreadIntoState(
              vaultPath,
              active,
              listed.threads,
              openIds,
              tabs.pinnedTabIds,
            ),
          );
        } catch (e) {
          set({
            ...emptySession(vaultPath),
            threads: listed.threads,
            openTabIds: openIds,
            pinnedTabIds: tabs.pinnedTabIds,
            error:
              e instanceof Error
                ? `Could not open last chat: ${e.message}`
                : "Could not open last chat",
          });
        }
      } else {
        set({
          ...emptySession(vaultPath),
          threads: listed.threads,
          openTabIds: openIds,
          pinnedTabIds: tabs.pinnedTabIds,
        });
      }
      void get().refreshSkillsCatalog();
    } catch (e) {
      set({
        vaultBound: vaultPath,
        error: e instanceof Error ? e.message : String(e),
        status: "error",
        streamStartedAt: null,
      });
    }
  },

  refreshSkillsCatalog: async () => {
    try {
      const skills = await listSkills();
      set({ skillsCatalog: skills });
      return skills;
    } catch {
      set({ skillsCatalog: [] });
      return [];
    }
  },

  setDraft: (draft) => {
    const draftSelections = pruneSelections(get().draftSelections, draft);
    const active = get().activeThreadId;
    if (active && draft.length > 0) {
      const attentionThreadIds = withoutAttention(
        get().attentionThreadIds,
        active,
      );
      set({ draft, draftSelections, attentionThreadIds });
      return;
    }
    set({ draft, draftSelections });
  },

  addSelectionToDraft: (text, sourcePath) => {
    const clean = text.trim();
    if (!clean) return "";
    const id = crypto.randomUUID().slice(0, 8);
    const draft = get().draft;
    const gap = draft.length > 0 && !/\s$/.test(draft) ? " " : "";
    set({
      draft: `${draft}${gap}${wrapSelectionMarker(id)} `,
      draftSelections: {
        ...get().draftSelections,
        [id]: { id, text: truncateSelection(clean), sourcePath },
      },
    });
    return id;
  },

  addCommentToDraft: ({ quote, body, sourcePath }) => {
    const cleanQuote = quote.trim();
    const cleanBody = body.trim();
    const path = sourcePath.trim();
    if ((!cleanQuote && !cleanBody) || !path) return "";
    const id = crypto.randomUUID().slice(0, 8);
    const draft = get().draft;
    const gap = draft.length > 0 && !/\s$/.test(draft) ? " " : "";
    set({
      draft: `${draft}${gap}${wrapSelectionMarker(id)} `,
      draftSelections: {
        ...get().draftSelections,
        [id]: {
          id,
          kind: "comment",
          text: truncateSelection(cleanBody),
          quote: truncateSelection(cleanQuote),
          sourcePath: path,
        },
      },
    });
    return id;
  },

  clearThreadAttention: (threadId) => {
    set({
      attentionThreadIds: withoutAttention(get().attentionThreadIds, threadId),
    });
  },

  addAttachments: async (files) => {
    if (files.length === 0) return [];
    const prepared = await Promise.all(files.map((f) => fileToAttachment(f)));
    const { next, rejected } = mergeAttachments(
      get().draftAttachments,
      prepared,
    );
    set({ draftAttachments: next });
    return rejected;
  },

  removeAttachment: (id) => {
    set({
      draftAttachments: get().draftAttachments.filter((a) => a.id !== id),
    });
  },

  clearAttachments: () => set({ draftAttachments: [] }),

  setMode: (mode) => {
    set({
      mode,
      contextAnchorTokens: null,
      contextAnchorMessageCount: null,
    });
    void get().persistActive();
  },

  setModelId: (modelId) => {
    const settings = useAiSettingsStore.getState().settings;
    const resolved = resolveModelId(settings.baseUrl, modelId);
    const supports = modelSupportsReasoning(resolved);
    set({
      modelId: resolved,
      // Selecting a reasoning model sticks Reasoning on; chat models force off.
      enableReasoning: supports,
      contextAnchorTokens: null,
      contextAnchorMessageCount: null,
    });
    void get().persistActive();
  },

  setEnableReasoning: (enableReasoning) => {
    const supports = modelSupportsReasoning(get().modelId);
    set({
      enableReasoning: supports ? enableReasoning : false,
      contextAnchorTokens: null,
      contextAnchorMessageCount: null,
    });
    void get().persistActive();
  },

  setTerminalAllowForChat: (allow) => {
    const next = Boolean(allow);
    setTerminalThreadAutoAllow(next);
    set({ terminalAllowForChat: next });
    void get().persistActive();
  },

  setProjectPath: async (projectPath) => {
    const next = projectPath?.trim() || null;
    const project = await loadProjectContext(next);
    const activeThreadId = get().activeThreadId;
    set({
      projectPath: next,
      projectAbout: project.about,
      projectType: project.projectType,
      projectLearningLanguage: project.learningLanguage,
      contextAnchorTokens: null,
      contextAnchorMessageCount: null,
      threads: activeThreadId
        ? get().threads.map((t) =>
            t.id === activeThreadId ? { ...t, projectPath: next } : t,
          )
        : get().threads,
    });
    void get().persistActive();
  },

  clearActiveGem: async () => {
    const activeThreadId = get().activeThreadId;
    set({
      gemId: null,
      gemName: "",
      gemInstructions: "",
      contextAnchorTokens: null,
      contextAnchorMessageCount: null,
      threads: activeThreadId
        ? get().threads.map((t) =>
            t.id === activeThreadId ? { ...t, gemId: null } : t,
          )
        : get().threads,
    });
    void get().persistActive();
  },

  refreshActiveGem: async () => {
    const current = get().gemId;
    if (!current) return;
    const gem = await loadGemContext(current);
    if (!gem.gemId) {
      await get().clearActiveGem();
      return;
    }
    set({
      gemId: gem.gemId,
      gemName: gem.gemName,
      gemInstructions: gem.gemInstructions,
      contextAnchorTokens: null,
      contextAnchorMessageCount: null,
    });
  },

  clearError: () => set({ error: null, status: "ready" }),

  newThread: async (opts) => {
    await createNewThread(get, set, null, opts);
  },

  newThreadWithGem: async (gemId) => {
    const id = gemId?.trim();
    if (!id) return;
    await createNewThread(get, set, id);
  },

  selectThread: async (threadId) => {
    const vaultPath = get().vaultBound;
    if (!vaultPath) return;
    if (threadId === get().activeThreadId) return;
    if (isChatBusy(get().status)) get().stop();

    let openTabIds = get().openTabIds;
    if (!openTabIds.includes(threadId)) {
      openTabIds = [...openTabIds, threadId];
    }
    await persistChatTabs(get, openTabIds, threadId);
    const listed = await listChatThreads(vaultPath);
    const tabs = applyListedTabs(listed);
    set(
      await loadThreadIntoState(
        vaultPath,
        threadId,
        listed.threads,
        tabs.openTabIds,
        tabs.pinnedTabIds,
      ),
    );
    set({
      draft: "",
      draftAttachments: [],
      attentionThreadIds: withoutAttention(get().attentionThreadIds, threadId),
    });
  },

  closeTab: async (threadId) => {
    const vaultPath = get().vaultBound;
    if (!vaultPath) return;
    if (get().activeThreadId === threadId && isChatBusy(get().status)) {
      get().stop();
    }

    const prevTabs = get().openTabIds;
    const idx = prevTabs.indexOf(threadId);
    const openTabIds = prevTabs.filter((id) => id !== threadId);
    const wasActive = get().activeThreadId === threadId;
    const currentActive = get().activeThreadId;
    const nextActive = wasActive
      ? (openTabIds[Math.max(0, idx - 1)] ?? openTabIds[0] ?? null)
      : currentActive && openTabIds.includes(currentActive)
        ? currentActive
        : openTabIds[0] ?? null;

    // Empty chats must not linger in history after the tab is closed.
    await deleteEmptyClosedThreads(vaultPath, [threadId], get);

    const listed = await persistChatTabs(get, openTabIds, nextActive);
    if (!listed) return;

    if (!nextActive) {
      set({
        threads: listed.threads,
        ...applyListedTabs(listed),
        activeThreadId: null,
        messages: [],
        status: "ready",
        error: null,
        draft: "",
        draftAttachments: [],
        streamStartedAt: null,
        attentionThreadIds: withoutAttention(
          get().attentionThreadIds,
          threadId,
        ),
        ...defaultsFromSettings(),
      });
      return;
    }

    if (wasActive) {
      const tabs = applyListedTabs(listed);
      set(
        await loadThreadIntoState(
          vaultPath,
          nextActive,
          listed.threads,
          tabs.openTabIds,
          tabs.pinnedTabIds,
        ),
      );
      set({
        draft: "",
        draftAttachments: [],
        attentionThreadIds: withoutAttention(
          withoutAttention(get().attentionThreadIds, threadId),
          nextActive,
        ),
      });
    } else {
      set({
        threads: listed.threads,
        ...applyListedTabs(listed),
        activeThreadId: listed.activeThreadId,
        attentionThreadIds: withoutAttention(
          get().attentionThreadIds,
          threadId,
        ),
      });
    }
  },

  closeOtherTabs: async (threadId) => {
    const tabs = chatPinnableTabs(get().openTabIds, get().pinnedTabIds);
    await closeChatTabsKeeping(get, set, keepForCloseOthers(tabs, threadId));
  },

  closeTabsToTheRight: async (threadId) => {
    const tabs = chatPinnableTabs(get().openTabIds, get().pinnedTabIds);
    if (!tabs.some((t) => t.path === threadId)) return;
    await closeChatTabsKeeping(
      get,
      set,
      keepForCloseToTheRight(tabs, threadId),
    );
  },

  setTabPinned: async (threadId, pinned) => {
    const vaultPath = get().vaultBound;
    if (!vaultPath) return;
    const next = applyTabPinned(
      chatPinnableTabs(get().openTabIds, get().pinnedTabIds),
      threadId,
      pinned,
    );
    const openTabIds = next.map((t) => t.path);
    const pinnedTabIds = next.filter((t) => t.pinned).map((t) => t.path);
    if (
      openTabIds.length === get().openTabIds.length &&
      openTabIds.every((id, i) => id === get().openTabIds[i]) &&
      pinnedTabIds.length === get().pinnedTabIds.length &&
      pinnedTabIds.every((id, i) => id === get().pinnedTabIds[i])
    ) {
      return;
    }
    set({ openTabIds, pinnedTabIds });
    const listed = await persistChatTabs(
      get,
      openTabIds,
      get().activeThreadId,
      pinnedTabIds,
    );
    if (!listed) return;
    set({
      threads: listed.threads,
      ...applyListedTabs(listed),
      activeThreadId: listed.activeThreadId,
    });
  },

  reorderOpenTabs: async (fromIndex, toIndex) => {
    const vaultPath = get().vaultBound;
    if (!vaultPath) return;
    const next = reorderEditorTabs(
      chatPinnableTabs(get().openTabIds, get().pinnedTabIds),
      fromIndex,
      toIndex,
    );
    const openTabIds = next.map((t) => t.path);
    const pinnedTabIds = next.filter((t) => t.pinned).map((t) => t.path);
    if (
      openTabIds.length === get().openTabIds.length &&
      openTabIds.every((id, i) => id === get().openTabIds[i]) &&
      pinnedTabIds.length === get().pinnedTabIds.length &&
      pinnedTabIds.every((id, i) => id === get().pinnedTabIds[i])
    ) {
      return;
    }
    set({ openTabIds, pinnedTabIds });
    const listed = await persistChatTabs(
      get,
      openTabIds,
      get().activeThreadId,
      pinnedTabIds,
    );
    if (!listed) return;
    set({
      threads: listed.threads,
      ...applyListedTabs(listed),
      activeThreadId: listed.activeThreadId,
    });
  },

  deleteThread: async (threadId) => {
    const vaultPath = get().vaultBound;
    if (!vaultPath) return;
    if (get().activeThreadId === threadId && isChatBusy(get().status)) {
      get().stop();
    }
    await deleteChatThread(vaultPath, threadId);
    const listed = await listChatThreads(vaultPath);
    const tabs = applyListedTabs(listed);
    const active = listed.activeThreadId;

    if (!active) {
      set({
        threads: listed.threads,
        ...tabs,
        activeThreadId: null,
        messages: [],
        status: "ready",
        error: null,
        draft: "",
        draftAttachments: [],
        streamStartedAt: null,
        attentionThreadIds: withoutAttention(
          get().attentionThreadIds,
          threadId,
        ),
        ...defaultsFromSettings(),
      });
      return;
    }

    set(
      await loadThreadIntoState(
        vaultPath,
        active,
        listed.threads,
        tabs.openTabIds,
        tabs.pinnedTabIds,
      ),
    );
    set({
      draft: "",
      draftAttachments: [],
      attentionThreadIds: withoutAttention(
        withoutAttention(get().attentionThreadIds, threadId),
        active,
      ),
    });
  },

  renameThread: async (threadId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const vaultPath = get().vaultBound ?? useVaultStore.getState().vaultPath;
    if (!vaultPath) return;

    const now = Date.now();
    set({
      threads: get().threads.map((t) =>
        t.id === threadId
          ? { ...t, title: trimmed, titleLocked: true, updatedAt: now }
          : t,
      ),
    });

    if (get().activeThreadId === threadId) {
      await get().persistActive();
      return;
    }

    try {
      const file = await getChatThread(vaultPath, threadId);
      await upsertChatThread(vaultPath, {
        ...file,
        title: trimmed,
        titleLocked: true,
        updatedAt: now,
      });
      const listed = await listChatThreads(vaultPath);
      set({
        threads: listed.threads,
        ...applyListedTabs(listed),
      });
    } catch {
      /* best-effort */
    }
  },

  persistActive: () => enqueuePersistActive(get),

  send: async (text) => {
    const rawDraft = text ?? get().draft;
    const skillIds = extractSkillIdsFromDraft(rawDraft);
    const toolIds = extractToolIdsFromDraft(rawDraft);
    // Keep path/skill/tool markers in stored user text so bubbles render chips;
    // runChat unwraps them for the model.
    const draftText = expandSelectionMarkers(
      rawDraft,
      get().draftSelections,
    );
    const attachments = get().draftAttachments;
    const content = unwrapComposerMarkers(draftText).trim();
    if (!content && attachments.length === 0) return;
    if (isChatBusy(get().status)) return;

    const history = get().messages;
    const { parts, titleHint } = prepareUserMessageParts(
      draftText,
      attachments,
    );
    if (parts.length === 0) return;

    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts,
    };
    await runAssistantTurn({
      messages: [...history, userMessage],
      skillIds,
      toolIds,
      clearDraft: true,
      titleHint,
      estimateHistory: history,
      estimateDraft: draftText,
      estimateAttachments: attachments,
    });
  },

  retryFromUserMessage: async (messageId) => {
    if (isChatBusy(get().status)) return;
    const all = get().messages;
    const idx = all.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = all[idx]!;
    if (target.role !== "user") return;
    const meta = (
      target as UIMessage & { metadata?: { kind?: string } }
    ).metadata;
    if (meta?.kind === "question-answer") return;

    const truncated = all.slice(0, idx + 1);
    const rawText = userText(target);
    const skillIds = extractSkillIdsFromDraft(rawText);
    const toolIds = extractToolIdsFromDraft(rawText);

    await runAssistantTurn({
      messages: truncated,
      skillIds,
      toolIds,
      clearDraft: false,
    });
  },

  stop: () => {
    const { abort } = get();
    cancelAllPendingAskUser("stopped");
    cancelAllPendingIeltsPaper("stopped");
    cancelAllPendingPickVaultFolder("stopped");
    cancelAllPendingTerminal("stopped");
    void killAllRunningTerminalJobs();
    if (abort) abort.abort();
    set({
      abort: null,
      status: "ready",
      streamStartedAt: null,
      streamReasoningText: null,
    });
  },

  systemPromptPreview: () => {
    const vault = useVaultStore.getState();
    return buildSystemPrompt({
      mode: get().mode,
      vaultPath: vault.vaultPath,
      activePath: vault.activePath,
      activeExcerpt: vault.content ? vault.content.slice(0, 4000) : null,
      projectPath: get().projectPath,
      projectAbout: get().projectAbout,
      folderContext: folderContextForChat({
        activePath: vault.activePath,
        projectPath: get().projectPath,
        composerText: get().draft,
      }),
      projectType: get().projectType,
      projectLearningLanguage: get().projectLearningLanguage,
      gemName: get().gemName,
      gemInstructions: get().gemInstructions,
      skills: get().skillsCatalog,
    });
  },
}));

export function activeContextWindow(): number {
  const settings = useAiSettingsStore.getState().settings;
  const modelId = useChatStore.getState().modelId || vaultChatModelId();
  return contextWindowForModel(settings, modelId);
}
