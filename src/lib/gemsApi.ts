import { invoke } from "@tauri-apps/api/core";

export type Gem = {
  id: string;
  name: string;
  instructions: string;
  modelId: string;
  /** When the model supports thinking, whether this Gem enables it. */
  enableReasoning: boolean;
  createdAt: number;
  updatedAt: number;
};

export type UpsertGemInput = {
  id?: string | null;
  name: string;
  instructions: string;
  modelId: string;
  enableReasoning: boolean;
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
