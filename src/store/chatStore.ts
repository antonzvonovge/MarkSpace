import type { UIMessage } from "ai";
import { create } from "zustand";
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
import { useAiSettingsStore } from "./aiSettingsStore";
import { useVaultStore } from "./vaultStore";

export type ChatStatus = "ready" | "streaming" | "error";

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
  vaultBound: string | null;
  abort: AbortController | null;
  streamStartedAt: number | null;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setDraft: (draft: string) => void;
  setMode: (mode: ChatMode) => void;
  setModelId: (modelId: string) => void;
  newThread: () => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  closeTab: (threadId: string) => Promise<void>;
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
    draft: "",
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
  };
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
  vaultBound: null,
  abort: null,
  streamStartedAt: null,

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
    set({ draft: "" });
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
      set({ draft: "" });
    } else {
      set({
        threads: listed.threads,
        openTabIds: listed.openTabIds,
        activeThreadId: listed.activeThreadId,
      });
    }
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
    set({ draft: "" });
  },

  persistActive: async () => {
    const { vaultBound, activeThreadId, messages, mode, modelId, threads } =
      get();
    if (!vaultBound || !activeThreadId) return;
    const meta = threads.find((t) => t.id === activeThreadId);
    const now = Date.now();
    const title =
      meta?.title && meta.title !== "New chat"
        ? meta.title
        : (() => {
            const firstUser = messages.find((m) => m.role === "user");
            return firstUser ? titleFromMessage(userText(firstUser)) : "New chat";
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
    const content = (text ?? get().draft).trim();
    if (!content) return;
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

    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: content }],
    };
    const messages = [...get().messages, userMessage];
    const firstUser = messages.find((m) => m.role === "user");
    const title = firstUser ? titleFromMessage(userText(firstUser)) : "New chat";

    set({
      messages,
      draft: "",
      status: "streaming",
      error: null,
      streamStartedAt: Date.now(),
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
      });
      set({
        messages: finalMessages,
        status: "ready",
        abort: null,
        streamStartedAt: null,
        error: null,
      });
      await get().persistActive();
    } catch (e) {
      const aborted =
        controller.signal.aborted ||
        (e instanceof Error && e.name === "AbortError");
      if (aborted) {
        set({ status: "ready", abort: null, streamStartedAt: null });
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
      });
      await get().persistActive();
    }
  },

  stop: () => {
    const { abort } = get();
    if (abort) abort.abort();
    set({ abort: null, status: "ready", streamStartedAt: null });
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
