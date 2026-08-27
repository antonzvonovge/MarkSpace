import { splitFrontmatter } from "../lib/noteFrontmatter";
import {
  SKILLS_FOLDER,
  createNote,
  isValidSkillId,
  listTree,
  readNote,
  skillIdFromPath,
  skillPathForId,
  writeNote,
  type TreeNode,
} from "../lib/vaultApi";
import {
  LEXICON_REORGANIZE_SKILL_ID,
  LEXICON_REORGANIZE_SKILL_MARKDOWN,
} from "./defaultSkills/lexiconReorganize";

export type SkillMeta = {
  id: string;
  path: string;
  description: string;
  disableModelInvocation: boolean;
};

export type LoadedSkill = {
  meta: SkillMeta;
  /** Markdown body after frontmatter (instructions). */
  body: string;
  /** Full file contents. */
  raw: string;
};

/** Template for a new skill note. */
export function skillTemplate(id: string): string {
  return `---
description: Describe what this skill does and when to use it.
disable-model-invocation: false
---

# ${id}

## Instructions

Step-by-step guidance for the agent.
`;
}

export function parseSkillMeta(
  id: string,
  path: string,
  markdown: string,
): SkillMeta {
  const { data } = splitFrontmatter(markdown);
  const description =
    typeof data?.description === "string" ? data.description.trim() : "";
  const disableRaw = data?.["disable-model-invocation"];
  const disableModelInvocation =
    disableRaw === true ||
    disableRaw === "true" ||
    disableRaw === 1 ||
    disableRaw === "1";
  return { id, path, description, disableModelInvocation };
}

function findSkillsFolder(tree: TreeNode | null | undefined): TreeNode | null {
  if (!tree) return null;
  for (const child of tree.children ?? []) {
    if (child.isDir && child.path === SKILLS_FOLDER) return child;
  }
  return null;
}

/** Skills eligible for model auto-discovery (catalog). */
export function isCatalogSkill(meta: SkillMeta): boolean {
  return (
    isValidSkillId(meta.id) &&
    meta.description.length > 0 &&
    !meta.disableModelInvocation
  );
}

/**
 * Write built-in skills into Skills/ when missing (does not overwrite user edits).
 * Returns paths that were created.
 */
export async function ensureDefaultSkills(): Promise<string[]> {
  const created: string[] = [];
  const defaults: { id: string; markdown: string }[] = [
    {
      id: LEXICON_REORGANIZE_SKILL_ID,
      markdown: LEXICON_REORGANIZE_SKILL_MARKDOWN,
    },
  ];
  for (const skill of defaults) {
    if (!isValidSkillId(skill.id)) continue;
    const path = skillPathForId(skill.id);
    try {
      await readNote(path);
      continue;
    } catch {
      /* missing — seed */
    }
    try {
      const notePath = await createNote(path);
      await writeNote(notePath, skill.markdown);
      created.push(notePath);
    } catch {
      /* vault not ready / Skills missing */
    }
  }
  return created;
}

/** List skill metadata from the open vault's Skills/ folder. */
export async function listSkills(): Promise<SkillMeta[]> {
  const tree = await listTree();
  const folder = findSkillsFolder(tree);
  const out: SkillMeta[] = [];
  if (folder) {
    for (const child of folder.children ?? []) {
      if (child.isDir) continue;
      const id = skillIdFromPath(child.path);
      if (!id || !isValidSkillId(id)) continue;
      try {
        const raw = await readNote(child.path);
        out.push(parseSkillMeta(id, child.path, raw));
      } catch {
        /* skip unreadable */
      }
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Load one skill by id (filename stem). */
export async function loadSkill(id: string): Promise<LoadedSkill | null> {
  if (!isValidSkillId(id)) return null;
  const path = skillPathForId(id);
  try {
    const raw = await readNote(path);
    const { body } = splitFrontmatter(raw);
    return {
      meta: parseSkillMeta(id, path, raw),
      body: body.trimStart(),
      raw,
    };
  } catch {
    return null;
  }
}

/** Load several skills; skips missing ids. */
export async function loadSkills(
  ids: string[],
): Promise<LoadedSkill[]> {
  const seen = new Set<string>();
  const out: LoadedSkill[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const loaded = await loadSkill(id);
    if (loaded) out.push(loaded);
  }
  return out;
}

/** Lines for the system-prompt skill catalog. */
export function formatSkillsCatalogLines(skills: SkillMeta[]): string[] {
  const catalog = skills.filter(isCatalogSkill);
  if (catalog.length === 0) return [];
  const lines = [
    "Available skills (call read_skill with the skill name when the task matches a description):",
  ];
  for (const s of catalog) {
    const desc =
      s.description.length > 300
        ? `${s.description.slice(0, 297)}…`
        : s.description;
    lines.push(`- ${s.id}: ${desc}`);
  }
  return lines;
}

/** Inject full skill bodies forced by the user (slash). */
export function formatForcedSkillsLines(skills: LoadedSkill[]): string[] {
  if (skills.length === 0) return [];
  const lines = [
    "User requested skill(s) for this turn. Follow their instructions:",
  ];
  for (const s of skills) {
    lines.push(`Skill: ${s.meta.id}`);
    if (s.meta.description) {
      lines.push(`Description: ${s.meta.description}`);
    }
    lines.push("```");
    lines.push(s.body.slice(0, 20_000));
    lines.push("```");
  }
  return lines;
}
