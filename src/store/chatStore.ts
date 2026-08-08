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
import { formatAiError, runChat } from "../ai/runChat";
import { resolveModelId } from "../ai/resolveModelId";
import { listSkills, loadSkills, type SkillMeta } from "../ai/skills";
import { buildSystemPrompt } from "../ai/vaultTools";
import { contextWindowForModel, type ChatMode } from "../ai/types";
import {
  deleteChatThread,
  getChatThread,
  listChatThreads,
  setOpenChatTabs,
  upsertChatThread,
  type ChatThreadMeta,
} from "../lib/chatHistoryApi";
import { arrayMove } from "../lib/arrayMove";
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
import { useAiSettingsStore } from "./aiSettingsStore";
import { useVaultStore } from "./vaultStore";

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
function isProvisionalTitle(title: string | undefined, messages: UIMessage[]): boolean {
  if (!title || title === "New chat") return true;
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return true;
  return title === titleFromMessage(userText(firstUser));
}

type ChatStore = {
  threads: ChatThreadMeta[];
  /** Ordered open chat tabs (may be empty). */
  openTabIds: string[];
  activeThreadId: string | null;
  messages: UIMessage[];
  mode: ChatMode;
  modelId: string;
  /** Selected vault project path, or null for none. */
  projectPath: string | null;
  /** Cached "about" text for `projectPath` (for prompt + context meter). */
  projectAbout: string;
  /** Cached project type for `projectPath`. */
  projectType: ProjectTypeId;
  /** Cached learning language code when type is language learning. */
  projectLearningLanguage: string;
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
  setProjectPath: (projectPath: string | null) => Promise<void>;
  refreshSkillsCatalog: () => Promise<SkillMeta[]>;
  newThread: () => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  closeTab: (threadId: string) => Promise<void>;
  closeOtherTabs: (threadId: string) => Promise<void>;
  closeTabsToTheRight: (threadId: string) => Promise<void>;
  reorderOpenTabs: (fromIndex: number, toIndex: number) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  send: (text?: string) => Promise<void>;
  stop: () => void;
  clearError: () => void;
  persistActive: () => Promise<void>;
  systemPromptPreview: () => string;
};

function defaultsFromSettings(): { mode: ChatMode; modelId: string } {
  const s = useAiSettingsStore.getState().settings;
  return { mode: s.defaultMode, modelId: s.modelId };
}

function DEFAULT_MODEL_PLACEHOLDER(): string {
  try {
    return useAiSettingsStore.getState().settings.modelId;
  } catch {
    return "anthropic/claude-sonnet-4.6";
  }
}

function emptySession(vaultBound: string | null = null) {
  return {
    vaultBound,
    threads: [] as ChatThreadMeta[],
    openTabIds: [] as string[],
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
    skillsCatalog: [] as SkillMeta[],
    contextAnchorTokens: null as number | null,
    contextAnchorMessageCount: null as number | null,
    ...defaultsFromSettings(),
  };
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

type ProjectContext = {
  about: string;
  projectType: ProjectTypeId;
  learningLanguage: string;
};

const EMPTY_PROJECT_CONTEXT: ProjectContext = {
  about: "",
  projectType: "",
  learningLanguage: "",
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

async function loadThreadIntoState(
  vaultPath: string,
  threadId: string,
  threads: ChatThreadMeta[],
  openTabIds: string[],
) {
  const { modelId } = defaultsFromSettings();
  const baseUrl = useAiSettingsStore.getState().settings.baseUrl;
  const thread = await getChatThread(vaultPath, threadId);
  const projectPath = thread.projectPath?.trim() || null;
  const project = await loadProjectContext(projectPath);
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
  return {
    vaultBound: vaultPath,
    threads,
    openTabIds,
    activeThreadId: threadId,
    messages: Array.isArray(thread.messages) ? thread.messages : [],
    mode: thread.mode === "agent" ? ("agent" as const) : ("ask" as const),
    modelId: resolveModelId(baseUrl, thread.modelId || modelId),
    projectPath,
    projectAbout: project.about,
    projectType: project.projectType,
    projectLearningLanguage: project.learningLanguage,
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
  const listed = await setOpenChatTabs(vaultPath, openTabIds, nextActive);

  let attention = get().attentionThreadIds;
  for (const id of closedIds) {
    attention = withoutAttention(attention, id);
  }

  if (!nextActive) {
    set({
      threads: listed.threads,
      openTabIds: listed.openTabIds,
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

  if (closingActive) {
    set(
      await loadThreadIntoState(
        vaultPath,
        nextActive,
        listed.threads,
        listed.openTabIds,
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
      openTabIds: listed.openTabIds,
      activeThreadId: listed.activeThreadId,
      attentionThreadIds: attention,
    });
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
  if (!meta || !isProvisionalTitle(meta.title, messages)) return;

  const title = await generateChatTitle({
    messages,
    keys: api.keys,
    fallbackModelId: api.modelId,
  });
  if (!title) return;

  const latest = useChatStore.getState();
  const latestMeta = latest.threads.find((t) => t.id === threadId);
  if (!latestMeta || !isProvisionalTitle(latestMeta.title, messages)) return;

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
      openTabIds: listed.openTabIds,
    });
  } catch {
    /* best-effort */
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  threads: [],
  openTabIds: [],
  activeThreadId: null,
  messages: [],
  mode: "ask",
  modelId: DEFAULT_MODEL_PLACEHOLDER(),
  projectPath: null,
  projectAbout: "",
  projectType: "",
  projectLearningLanguage: "",
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
      set(emptySession(null));
      return;
    }
    try {
      const { threads, activeThreadId, openTabIds } =
        await listChatThreads(vaultPath);
      const tabs = openTabIds.filter((id) => threads.some((t) => t.id === id));
      const active =
        activeThreadId && tabs.includes(activeThreadId)
          ? activeThreadId
          : tabs[0] ?? null;

      if (active) {
        set(await loadThreadIntoState(vaultPath, active, threads, tabs));
      } else {
        set({
          ...emptySession(vaultPath),
          threads,
          openTabIds: tabs,
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
    set({
      modelId: resolved,
      contextAnchorTokens: null,
      contextAnchorMessageCount: null,
    });
    void get().persistActive();
  },

  setProjectPath: async (projectPath) => {
    const next = projectPath?.trim() || null;
    const project = await loadProjectContext(next);
    set({
      projectPath: next,
      projectAbout: project.about,
      projectType: project.projectType,
      projectLearningLanguage: project.learningLanguage,
      contextAnchorTokens: null,
      contextAnchorMessageCount: null,
    });
    void get().persistActive();
  },

  clearError: () => set({ error: null, status: "ready" }),

  newThread: async () => {
    const vaultPath = get().vaultBound ?? useVaultStore.getState().vaultPath;
    if (!vaultPath) return;
    if (isChatBusy(get().status)) get().stop();
    const { mode, modelId } = defaultsFromSettings();
    const now = Date.now();
    const id = crypto.randomUUID();
    const empty = {
      id,
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      mode,
      modelId,
      projectPath: null as string | null,
      messages: [] as UIMessage[],
    };
    const meta = await upsertChatThread(vaultPath, empty);
    const openTabIds = [
      ...get().openTabIds.filter((t) => t !== id),
      id,
    ];
    await setOpenChatTabs(vaultPath, openTabIds, id);
    const listed = await listChatThreads(vaultPath);
    set({
      vaultBound: vaultPath,
      threads: listed.threads,
      openTabIds: listed.openTabIds,
      activeThreadId: id,
      messages: [],
      mode: meta.mode === "agent" ? "agent" : "ask",
      modelId: meta.modelId || modelId,
      projectPath: null,
      projectAbout: "",
      projectType: "",
      projectLearningLanguage: "",
      contextAnchorTokens: null,
      contextAnchorMessageCount: null,
      status: "ready",
      error: null,
      draft: "",
      draftAttachments: [],
      streamStartedAt: null,
    });
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
    await setOpenChatTabs(vaultPath, openTabIds, threadId);
    const listed = await listChatThreads(vaultPath);
    set(
      await loadThreadIntoState(
        vaultPath,
        threadId,
        listed.threads,
        listed.openTabIds,
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

    const listed = await setOpenChatTabs(vaultPath, openTabIds, nextActive);

    if (!nextActive) {
      set({
        threads: listed.threads,
        openTabIds: listed.openTabIds,
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
      set(
        await loadThreadIntoState(
          vaultPath,
          nextActive,
          listed.threads,
          listed.openTabIds,
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
        openTabIds: listed.openTabIds,
        activeThreadId: listed.activeThreadId,
        attentionThreadIds: withoutAttention(
          get().attentionThreadIds,
          threadId,
        ),
      });
    }
  },

  closeOtherTabs: async (threadId) => {
    await closeChatTabsKeeping(get, set, new Set([threadId]));
  },

  closeTabsToTheRight: async (threadId) => {
    const prev = get().openTabIds;
    const idx = prev.indexOf(threadId);
    if (idx < 0) return;
    await closeChatTabsKeeping(get, set, new Set(prev.slice(0, idx + 1)));
  },

  reorderOpenTabs: async (fromIndex, toIndex) => {
    const vaultPath = get().vaultBound;
    if (!vaultPath) return;
    const prev = get().openTabIds;
    const openTabIds = arrayMove(prev, fromIndex, toIndex);
    if (openTabIds === prev) return;
    set({ openTabIds });
    const listed = await setOpenChatTabs(
      vaultPath,
      openTabIds,
      get().activeThreadId,
    );
    set({
      threads: listed.threads,
      openTabIds: listed.openTabIds,
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
    const openTabIds = listed.openTabIds;
    const active = listed.activeThreadId;

    if (!active) {
      set({
        threads: listed.threads,
        openTabIds,
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
        openTabIds,
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

  persistActive: async () => {
    const {
      vaultBound,
      activeThreadId,
      messages,
      mode,
      modelId,
      projectPath,
      contextAnchorTokens,
      contextAnchorMessageCount,
      threads,
    } = get();
    if (!vaultBound || !activeThreadId) return;
    const meta = threads.find((t) => t.id === activeThreadId);
    const now = Date.now();
    const title =
      meta?.title && !isProvisionalTitle(meta.title, messages)
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
      contextAnchorTokens,
      contextAnchorMessageCount,
      messages,
    };
    const updated = await upsertChatThread(vaultBound, file);
    const listed = await listChatThreads(vaultBound);
    set({
      threads: listed.threads,
      openTabIds: listed.openTabIds,
      activeThreadId: updated.id,
    });
  },

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
    const vaultPath =
      get().vaultBound ?? useVaultStore.getState().vaultPath;
    if (!vaultPath) {
      set({ error: "Open a vault to chat", status: "error" });
      return;
    }

    const settings = useAiSettingsStore.getState().settings;
    const keys = credentialsFromSettings(settings);
    const modelId = resolveModelId(
      settings.baseUrl,
      get().modelId || settings.modelId,
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
    const forcedSkills = skillIds.length
      ? await loadSkills(skillIds)
      : [];
    const forcedTools = toolIds.length ? toolIds : [];
    const mode = get().mode;
    const limit = contextWindowForModel(settings, modelId);
    const system = buildSystemPrompt({
      mode,
      vaultPath,
      activePath: vault.activePath,
      activeExcerpt: excerpt,
      projectPath,
      projectAbout: project.about,
      projectType: project.projectType,
      projectLearningLanguage: project.learningLanguage,
      skills,
      forcedSkills,
      forcedTools,
    });
    const anchorTokens = get().contextAnchorTokens;
    const anchorCount = get().contextAnchorMessageCount;

    let history = get().messages;
    let usedBeforeSend = estimateUsedContext({
      system,
      messages: history,
      draft: draftText,
      draftAttachments: attachments,
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
            fallbackModelId: modelId,
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
        set({
          messages: history,
          contextAnchorTokens: null,
          contextAnchorMessageCount: null,
        });
        usedBeforeSend = estimateUsedContext({
          system,
          messages: history,
          draft: draftText,
          draftAttachments: attachments,
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

    const { parts, titleHint } = prepareUserMessageParts(
      draftText,
      attachments,
    );
    if (parts.length === 0) {
      set({
        abort: null,
        status: "ready",
        streamStartedAt: null,
      });
      return;
    }

    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts,
    };
    const messages = [...history, userMessage];
    const prevMeta = get().threads.find((t) => t.id === activeThreadId);
    const provisional = isProvisionalTitle(prevMeta?.title, messages);
    const firstUser = messages.find((m) => m.role === "user");
    const title = provisional
      ? firstUser
        ? titleFromMessage(userText(firstUser) || titleHint)
        : "New chat"
      : (prevMeta?.title ?? "New chat");

    set({
      messages,
      draft: "",
      draftAttachments: [],
      draftSelections: {},
      status: "streaming",
      error: null,
      streamStartedAt: Date.now(),
      streamReasoningText: null,
      abort: controller,
      threads: get().threads.map((t) =>
        t.id === activeThreadId ? { ...t, title, updatedAt: Date.now() } : t,
      ),
    });

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
        projectType: project.projectType,
        projectLearningLanguage: project.learningLanguage,
        skills,
        forcedSkills,
        forcedTools,
        contextWindow: limit,
        abortSignal: controller.signal,
        onMessages: (next) => {
          if (get().abort !== controller) return;
          set({ messages: next });
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
      // Only flag attention when the user is not already watching this thread
      // (they switched away or closed chat). Clear separately on composer focus.
      const viewingFinished =
        get().activeThreadId === activeThreadId;
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
      const viewingFinished =
        get().activeThreadId === activeThreadId;
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
  },

  stop: () => {
    const { abort } = get();
    cancelAllPendingAskUser("stopped");
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
      projectType: get().projectType,
      projectLearningLanguage: get().projectLearningLanguage,
      skills: get().skillsCatalog,
    });
  },
}));

export function activeContextWindow(): number {
  const settings = useAiSettingsStore.getState().settings;
  const modelId = useChatStore.getState().modelId || settings.modelId;
  return contextWindowForModel(settings, modelId);
}
