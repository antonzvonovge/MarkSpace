import { invoke } from "@tauri-apps/api/core";

export type Gem = {
  id: string;
  name: string;
  instructions: string;
  modelId: string;
  /** When the model supports thinking, whether this Gem enables it. */
  enableReasoning: boolean;
  /**
   * Optional cap on user turns sent to the model. One turn = one user message
   * plus the full assistant reply (reasoning, tools, text). Omit for full history.
   */
  recentUserTurns?: number | null;
  createdAt: number;
  updatedAt: number;
};

export type UpsertGemInput = {
  id?: string | null;
  name: string;
  instructions: string;
  modelId: string;
  enableReasoning: boolean;
  recentUserTurns?: number | null;
};

export async function listGems(): Promise<Gem[]> {
  return invoke<Gem[]>("list_gems");
}

export async function getGem(id: string): Promise<Gem> {
  return invoke<Gem>("get_gem", { id });
}

export async function upsertGem(gem: UpsertGemInput): Promise<Gem> {
  return invoke<Gem>("upsert_gem", { gem });
}

export async function deleteGem(id: string): Promise<void> {
  return invoke("delete_gem", { id });
}
