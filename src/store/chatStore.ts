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
import { formatAiError, runChat } from "../ai/runChat";
import { resolveModelId } from "../ai/resolveModelId";
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
import { useAiSettingsStore } from "./aiSettingsStore";
import { useVaultStore } from "./vaultStore";

export type ChatStatus = "ready" | "streaming" | "error";
export type { ChatAttachment };

function titleFromMessage(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
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
  status: ChatStatus;
  error: string | null;
  draft: string;
  draftAttachments: ChatAttachment[];
  vaultBound: string | null;
  abort: AbortController | null;
  streamStartedAt: number | null;
  /** Live thinking text; updated without rewriting `messages`. */
  streamReasoningText: string | null;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setDraft: (draft: string) => void;
  addAttachments: (files: File[]) => Promise<string[]>;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setMode: (mode: ChatMode) => void;
  setModelId: (modelId: string) => void;
  newThread: () => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  closeTab: (threadId: string) => Promise<void>;
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
    draft: "",
    draftAttachments: [] as ChatAttachment[],
    ...defaultsFromSettings(),
  };
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
  return {
    vaultBound: vaultPath,
    threads,
    openTabIds,
    activeThreadId: threadId,
    messages: Array.isArray(thread.messages) ? thread.messages : [],
    mode: thread.mode === "agent" ? ("agent" as const) : ("ask" as const),
    modelId: resolveModelId(baseUrl, thread.modelId || modelId),
    status: "ready" as const,
    error: null,
    abort: null,
    streamStartedAt: null,
    streamReasoningText: null,
  };
}

/** Replace provisional title with a short LLM-generated name (best-effort). */
async function maybeRefreshTitle(
  threadId: string,
  messages: UIMessage[],
  api: { apiKey: string; baseUrl: string; modelId: string },
) {
  const state = useChatStore.getState();
  const meta = state.threads.find((t) => t.id === threadId);
  if (!meta || !isProvisionalTitle(meta.title, messages)) return;

  const title = await generateChatTitle({
    messages,
    apiKey: api.apiKey,
    baseUrl: api.baseUrl,
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
  status: "ready",
  error: null,
  draft: "",
  draftAttachments: [],
  vaultBound: null,
  abort: null,
  streamStartedAt: null,
  streamReasoningText: null,

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
    } catch (e) {
      set({
        vaultBound: vaultPath,
        error: e instanceof Error ? e.message : String(e),
        status: "error",
        streamStartedAt: null,
      });
    }
  },

  setDraft: (draft) => set({ draft }),

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
    set({ mode });
    void get().persistActive();
  },

  setModelId: (modelId) => {
    const settings = useAiSettingsStore.getState().settings;
    const resolved = resolveModelId(settings.baseUrl, modelId);
    set({ modelId: resolved });
    void get().persistActive();
  },

  clearError: () => set({ error: null, status: "ready" }),

  newThread: async () => {
    const vaultPath = get().vaultBound ?? useVaultStore.getState().vaultPath;
    if (!vaultPath) return;
    if (get().status === "streaming") get().stop();
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
    if (get().status === "streaming") get().stop();

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
    set({ draft: "", draftAttachments: [] });
  },

  closeTab: async (threadId) => {
    const vaultPath = get().vaultBound;
    if (!vaultPath) return;
    if (get().activeThreadId === threadId && get().status === "streaming") {
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
      set({ draft: "", draftAttachments: [] });
    } else {
      set({
        threads: listed.threads,
        openTabIds: listed.openTabIds,
        activeThreadId: listed.activeThreadId,
      });
    }
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
    if (get().activeThreadId === threadId && get().status === "streaming") {
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
    set({ draft: "", draftAttachments: [] });
  },

  persistActive: async () => {
    const { vaultBound, activeThreadId, messages, mode, modelId, threads } =
      get();
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
    const draftText = text ?? get().draft;
    const attachments = get().draftAttachments;
    const content = draftText.trim();
    if (!content && attachments.length === 0) return;
    const vaultPath =
      get().vaultBound ?? useVaultStore.getState().vaultPath;
    if (!vaultPath) {
      set({ error: "Open a vault to chat", status: "error" });
      return;
    }

    const settings = useAiSettingsStore.getState().settings;
    if (!settings.apiKey.trim()) {
      set({ error: "Add an API key in Settings → AI", status: "error" });
      return;
    }

    if (get().status === "streaming") return;

    let activeThreadId = get().activeThreadId;
    if (!activeThreadId) {
      await get().newThread();
      activeThreadId = get().activeThreadId;
    }
    if (!activeThreadId) return;

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
    const messages = [...get().messages, userMessage];
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
      status: "streaming",
      error: null,
      streamStartedAt: Date.now(),
      streamReasoningText: null,
      threads: get().threads.map((t) =>
        t.id === activeThreadId ? { ...t, title, updatedAt: Date.now() } : t,
      ),
    });

    const controller = new AbortController();
    set({ abort: controller });

    const vault = useVaultStore.getState();
    const excerpt =
      vault.activePath && vault.content
        ? vault.content.slice(0, 4000)
        : null;

    try {
      const finalMessages = await runChat({
        messages,
        mode: get().mode,
        modelId: resolveModelId(
          settings.baseUrl,
          get().modelId || settings.modelId,
        ),
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || "https://openrouter.ai/api/v1",
        vaultPath,
        activePath: vault.activePath,
        activeExcerpt: excerpt,
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
      set({
        messages: finalMessages,
        status: "ready",
        abort: null,
        streamStartedAt: null,
        streamReasoningText: null,
        error: null,
      });
      await get().persistActive();
      await maybeRefreshTitle(activeThreadId, finalMessages, {
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || "https://openrouter.ai/api/v1",
        modelId: resolveModelId(
          settings.baseUrl,
          get().modelId || settings.modelId,
        ),
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
      set({
        messages: next,
        status: "error",
        error: message,
        abort: null,
        streamStartedAt: null,
        streamReasoningText: null,
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
    });
  },
}));

export function activeContextWindow(): number {
  const settings = useAiSettingsStore.getState().settings;
  const modelId = useChatStore.getState().modelId || settings.modelId;
  return contextWindowForModel(settings, modelId);
}
