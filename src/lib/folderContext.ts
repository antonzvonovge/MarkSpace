import { extractVaultPathsFromDraft } from "./chatComposerDom";
import { useVaultStore } from "../store/vaultStore";
import {
  folderPathFromFolderNote,
  isFolderNotePath,
  parentPath,
  type ProjectProperties,
} from "./vaultApi";

export const FOLDER_ABOUT_MAX_CHARS = 4000;

export type FolderAbout = {
  path: string;
  about: string;
};

const FOLDER_CONTEXT_INTRO =
  "Folder context (description and instructions for the AI). Follow these when working with notes in that folder. If they conflict, the deeper folder wins.";

/** Normalize a vault-relative path; empty after trim → null. */
export function normalizeVaultRelPath(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return trimmed || null;
}

/**
 * Folder that owns a vault chip or file path.
 * Folder chips (`A/B/` or `A/B`) stay as that folder. Files use the parent.
 * `.folder.md` maps to its parent folder.
 */
export function folderOfVaultPath(path: string): string | null {
  const raw = path.trim().replace(/\\/g, "/");
  const isFolderChip = raw.endsWith("/");
  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;
  if (isFolderChip) return trimmed;
  if (isFolderNotePath(trimmed)) {
    const folder = folderPathFromFolderNote(trimmed);
    return folder || null;
  }
  const name = trimmed.split("/").pop() ?? trimmed;
  if (name.includes(".")) {
    return parentPath(trimmed) || null;
  }
  return trimmed;
}

/** Ancestor folders from deepest to first-level project (excludes vault root). */
export function ancestorFolderPaths(folderPath: string): string[] {
  const trimmed = normalizeVaultRelPath(folderPath);
  if (!trimmed) return [];
  const parts = trimmed.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i--) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

function depthOf(path: string): number {
  return path.split("/").filter(Boolean).length;
}

/**
 * Union of non-empty `about` values along ancestor chains of the seed paths.
 * One entry per folder path. Deeper folders first.
 */
export function collectFolderAbouts(
  seedPaths: Array<string | null | undefined>,
  propsByPath: Record<string, ProjectProperties>,
): FolderAbout[] {
  const byPath = new Map<string, string>();
  for (const seed of seedPaths) {
    if (!seed?.trim()) continue;
    const folder = folderOfVaultPath(seed);
    if (!folder) continue;
    for (const path of ancestorFolderPaths(folder)) {
      if (byPath.has(path)) continue;
      const about = propsByPath[path]?.about?.trim() ?? "";
      if (!about) continue;
      byPath.set(path, about.slice(0, FOLDER_ABOUT_MAX_CHARS));
    }
  }
  return [...byPath.entries()]
    .map(([path, about]) => ({ path, about }))
    .sort((a, b) => depthOf(b.path) - depthOf(a.path) || a.path.localeCompare(b.path));
}

export function collectChatFolderAbouts(opts: {
  activePath?: string | null;
  projectPath?: string | null;
  composerText?: string | null;
  extraPaths?: Array<string | null | undefined>;
  propsByPath: Record<string, ProjectProperties>;
}): FolderAbout[] {
  const chips = opts.composerText
    ? extractVaultPathsFromDraft(opts.composerText)
    : [];
  return collectFolderAbouts(
    [opts.activePath, opts.projectPath, ...(opts.extraPaths ?? []), ...chips],
    opts.propsByPath,
  );
}

export function formatFolderContextBlock(entries: FolderAbout[]): string {
  if (entries.length === 0) return "";
  const lines = [FOLDER_CONTEXT_INTRO];
  for (const entry of entries) {
    lines.push(`- ${entry.path}:`);
    lines.push("```");
    lines.push(entry.about);
    lines.push("```");
  }
  return lines.join("\n");
}

export function withFolderContext(
  system: string,
  entries: FolderAbout[],
): string {
  const block = formatFolderContextBlock(entries);
  if (!block) return system;
  return `${system}\n\n${block}`;
}

export function withVaultFolderContext(
  system: string,
  seedPaths: Array<string | null | undefined>,
): string {
  const { projectPropertiesByPath } = useVaultStore.getState();
  return withFolderContext(
    system,
    collectFolderAbouts(seedPaths, projectPropertiesByPath),
  );
}

