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
};

export type ChatThreadFile = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: ChatMode;
  modelId: string;
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
