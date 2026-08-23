import {
  createNote,
  ensureFolder,
  joinPath,
  listTree,
  writeFileBytes,
  writeNote,
  type TreeNode,
} from "../lib/vaultApi";
import { useSidebarUiStore } from "../store/sidebarUiStore";
import { useVaultStore } from "../store/vaultStore";
import {
  ieltsSessionFileStem,
  ieltsSkillNeedsBundleFolder,
  nestIeltsBundleFolder,
  resolveIeltsFolder,
  topicsFromSessionFilenames,
} from "./ieltsDialogue";
import type { IeltsSkill } from "./ieltsFit";

const MAX_EXISTING_NOTES = 80;

function findFolderNode(root: TreeNode, folderPath: string): TreeNode | null {
  const rel = folderPath.replace(/^\/+|\/+$/g, "");
  if (!rel) return root;
  let cur: TreeNode = root;
  for (const part of rel.split("/").filter(Boolean)) {
    const next = (cur.children ?? []).find((c) => c.isDir && c.name === part);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

export async function listExistingSessionNotes(folder: string): Promise<string[]> {
  try {
    const root = await listTree();
    const node = findFolderNode(root, folder);
    if (!node) return [];
    const names: string[] = [];
    for (const child of node.children ?? []) {
      if (child.isDir) {
        if (/^\d{2}\.\d{2}\.\d{4}-/.test(child.name)) {
          names.push(`${child.name}.md`);
        }
        continue;
      }
      const lower = child.name.toLowerCase();
      if (!lower.endsWith(".md")) continue;
      if (child.name === ".folder.md") continue;
      names.push(child.name);
    }
    names.sort((a, b) => a.localeCompare(b));
    return names.slice(0, MAX_EXISTING_NOTES);
  } catch {
    return [];
  }
}

export async function listSessionTopics(folder: string): Promise<string[]> {
  const names = await listExistingSessionNotes(folder);
  return topicsFromSessionFilenames(names);
}

export type IeltsSessionTarget = {
  /** File stem shared by the note and its bundle folder. */
  stem: string;
  /** Folder that holds the note (and audio for listening). */
  dest: string;
};

export function ieltsSessionTarget(params: {
  skill: IeltsSkill;
  folder: string;
  variant: string;
  now?: Date;
}): IeltsSessionTarget {
  const folder = resolveIeltsFolder(params.folder);
  if (!folder) throw new Error("Choose a folder to save the session note.");
  const stem = ieltsSessionFileStem(
    `${params.skill}-${params.variant}`.replace(/^-|-$/g, ""),
    params.now,
  );
  const dest = ieltsSkillNeedsBundleFolder(params.skill)
    ? nestIeltsBundleFolder(folder, stem)
    : folder;
  return { stem, dest };
}

/** Written before practice so the player can stream the file instead of a blob. */
export async function writeIeltsSessionAudio(
  target: IeltsSessionTarget,
  filename: string,
  bytes: Uint8Array,
): Promise<string> {
  await ensureFolder(target.dest);
  return writeFileBytes(joinPath(target.dest, filename), bytes);
}

export async function saveIeltsSessionNote(params: {
  target: IeltsSessionTarget;
  markdown: string;
}): Promise<string> {
  const { dest, stem } = params.target;
  await ensureFolder(dest);
  const path = joinPath(dest, `${stem}.md`);
  try {
    await createNote(path);
  } catch {
    /* exists */
  }
  await writeNote(path, params.markdown);
  await useVaultStore.getState().refreshTree();
  await useVaultStore.getState().openNote(path, { preview: false });
  useSidebarUiStore.getState().revealPathInTree(path);
  return path;
}
