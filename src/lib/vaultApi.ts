import { invoke } from "@tauri-apps/api/core";

export type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
};

export type VaultChange = {
  kind: string;
  path: string;
};

export async function openVault(path: string): Promise<TreeNode> {
  return invoke("open_vault", { path });
}

export async function listTree(): Promise<TreeNode> {
  return invoke("list_tree");
}

export async function readNote(path: string): Promise<string> {
  return invoke("read_note", { path });
}

export async function writeNote(path: string, content: string): Promise<void> {
  return invoke("write_note", { path, content });
}

export async function createNote(path: string): Promise<string> {
  return invoke("create_note", { path });
}

export async function createFolder(path: string): Promise<void> {
  return invoke("create_folder", { path });
}

export async function renamePath(from: string, to: string): Promise<string> {
  return invoke("rename_path", { from, to });
}

export async function deletePath(path: string): Promise<void> {
  return invoke("delete_path", { path });
}

export async function resolveWikiTarget(target: string): Promise<string | null> {
  return invoke("resolve_wiki_target", { target });
}

export async function getVaultPath(): Promise<string | null> {
  return invoke("get_vault_path");
}
