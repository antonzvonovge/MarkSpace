import { invoke } from "@tauri-apps/api/core";
import type { UIMessage } from "ai";
import type { ChatMode } from "../ai/types";

export type ChatThreadMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: ChatMode;
  modelId: string;
  /** Vault project path (first-level folder), or omit/null for none. */
  projectPath?: string | null;
  /** Gem id under `.markspace/gems/`, or omit/null for none. */
  gemId?: string | null;
};

export type ChatThreadFile = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: ChatMode;
  modelId: string;
  /** Vault project path (first-level folder), or omit/null for none. */
  projectPath?: string | null;
  /** Gem id under `.markspace/gems/`, or omit/null for none. */
  gemId?: string | null;
  /**
   * Measured context baseline for the next prompt with an empty draft
   * (last API input tokens + trailing assistant text).
   */
  contextAnchorTokens?: number | null;
  /** `messages.length` when `contextAnchorTokens` was recorded. */
  contextAnchorMessageCount?: number | null;
  /** Sticky Reasoning toggle; omit on older threads. */
  enableReasoning?: boolean | null;
  /**
   * Skip per-command terminal approval for this thread (still requires
   * Settings → Allow agent terminal). Omit on older threads.
   */
  terminalAllowForChat?: boolean | null;
  messages: UIMessage[];
};

export type ChatThreadsResponse = {
  threads: ChatThreadMeta[];
  activeThreadId: string | null;
  openTabIds: string[];
};

export async function listChatThreads(
  vaultPath: string,
): Promise<ChatThreadsResponse> {
  return invoke("list_chat_threads", { vaultPath });
}

export async function getChatThread(
  vaultPath: string,
  threadId: string,
): Promise<ChatThreadFile> {
  return invoke("get_chat_thread", { vaultPath, threadId });
}

/** Absolute path to `{appData}/chats/<vaultKey>/<threadId>.json`. */
export async function getChatThreadPath(
  vaultPath: string,
  threadId: string,
): Promise<string> {
  return invoke("get_chat_thread_path", { vaultPath, threadId });
}

export async function upsertChatThread(
  vaultPath: string,
  thread: ChatThreadFile,
): Promise<ChatThreadMeta> {
  return invoke("upsert_chat_thread", { vaultPath, thread });
}

export async function deleteChatThread(
  vaultPath: string,
  threadId: string,
): Promise<void> {
  return invoke("delete_chat_thread", { vaultPath, threadId });
}

export async function setActiveChatThread(
  vaultPath: string,
  threadId: string | null,
): Promise<void> {
  return invoke("set_active_chat_thread", { vaultPath, threadId });
}

export async function setOpenChatTabs(
  vaultPath: string,
  openTabIds: string[],
  activeThreadId: string | null,
): Promise<ChatThreadsResponse> {
  return invoke("set_open_chat_tabs", {
    vaultPath,
    openTabIds,
    activeThreadId,
  });
}
