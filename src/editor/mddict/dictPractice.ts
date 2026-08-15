/** Build and shuffle practice cards from project dictionaries. */

import {
  parseMddict,
  type MddictItem,
} from "../../lib/mddictFormat";
import { readNote, type TreeNode } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";

export type PracticeKind = "toWord" | "toTranslation" | "cloze";

export type PracticeCard = {
  dictPath: string;
  word: string;
  transcript: string;
  translation: string;
  examples: string[];
  kind: PracticeKind;
  /** Prompt shown to the user (may include blanks). */
  prompt: string;
  /** Expected answer (case-insensitive compare). */
  answer: string;
};

function collectMddictPathsFromNode(node: TreeNode, out: string[]): void {
  if (!node.isDir) {
    if (node.path.toLowerCase().endsWith(".mddict")) out.push(node.path);
    return;
  }
  for (const child of node.children ?? []) collectMddictPathsFromNode(child, out);
}

export function collectProjectMddictPaths(
  tree: TreeNode | null | undefined,
  projectPath: string,
): string[] {
  const rootName = projectPath.trim();
  if (!rootName || !tree) return [];
  const projectNode = (tree.children ?? []).find(
    (n) => n.path === rootName && n.isDir,
  );
  if (!projectNode) return [];

  const out: string[] = [];
  collectMddictPathsFromNode(projectNode, out);
  return out.sort((a, b) => a.localeCompare(b));
}

/** All `.mddict` files in the vault, sorted by path. */
export function collectVaultMddictPaths(
  tree: TreeNode | null | undefined,
): string[] {
  if (!tree) return [];
  const out: string[] = [];
  collectMddictPathsFromNode(tree, out);
  return out.sort((a, b) => a.localeCompare(b));
}

/** Project dictionaries first (when `activePath` is set), then the rest. */
export function sortMddictPathsForPicker(
  paths: string[],
  activePath: string | null | undefined,
): string[] {
  const project = (activePath ?? "").split("/")[0]?.trim() ?? "";
  if (!project) return [...paths].sort((a, b) => a.localeCompare(b));
  const inProject: string[] = [];
  const rest: string[] = [];
  for (const path of paths) {
    if (path === project || path.startsWith(`${project}/`)) inProject.push(path);
    else rest.push(path);
  }
  inProject.sort((a, b) => a.localeCompare(b));
  rest.sort((a, b) => a.localeCompare(b));
  return [...inProject, ...rest];
}

type LearningProjectProps = {
  projectType?: string;
  learningLanguage?: string;
};

/**
 * Hide dictionaries that live in a language-learning project whose learning
 * language does not match `languageCode`. Dictionaries outside those projects
 * (or with no learning language set) stay visible.
 */
export function filterMddictPathsForLearningLanguage(
  paths: string[],
  projectPropertiesByPath: Record<string, LearningProjectProps>,
  languageCode: string,
): string[] {
  const lang = languageCode.trim().toLowerCase();
  if (!lang) return paths;
  return paths.filter((path) => {
    const project = path.split("/")[0]?.trim() ?? "";
    if (!project || project === path) return true;
    const props = projectPropertiesByPath[project];
    if (!props || props.projectType !== "languageLearning") return true;
    const learning = (props.learningLanguage ?? "").trim().toLowerCase();
    if (!learning) return true;
    return learning === lang;
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clozeExample(word: string, example: string): string | null {
  const w = word.trim();
  if (!w) return null;
  const re = new RegExp(escapeRegExp(w), "i");
  if (!re.test(example)) return null;
  return example.replace(re, "____");
}

function cardsForItem(dictPath: string, item: MddictItem): PracticeCard[] {
  const word = item.word.trim();
  if (!word || item.known) return [];
  const translation = item.translation.trim();
  const examples = item.examples.map((e) => e.trim()).filter(Boolean);
  const base = {
    dictPath,
    word,
    transcript: item.transcript,
    translation,
    examples,
  };
  const cards: PracticeCard[] = [];
  if (translation) {
    cards.push({
      ...base,
      kind: "toWord",
      prompt: translation,
      answer: word,
    });
    cards.push({
      ...base,
      kind: "toTranslation",
      prompt: word,
      answer: translation,
    });
  }
  for (const example of examples) {
    const blanked = clozeExample(word, example);
    if (!blanked) continue;
    cards.push({
      ...base,
      kind: "cloze",
      prompt: blanked,
      answer: word,
    });
  }
  return cards;
}

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export async function loadPracticeDeck(
  tree: TreeNode | null | undefined,
  projectPath: string,
): Promise<PracticeCard[]> {
  const paths = collectProjectMddictPaths(tree, projectPath);
  const cards: PracticeCard[] = [];
  for (const dictPath of paths) {
    try {
      const state = useVaultStore.getState();
      const openTab = state.tabs.find((t) => t.path === dictPath);
      const raw =
        state.activePath === dictPath && state.content != null
          ? state.content
          : openTab?.body != null
            ? openTab.body
            : await readNote(dictPath);
      const doc = parseMddict(raw);
      for (const item of doc.items) {
        cards.push(...cardsForItem(dictPath, item));
      }
    } catch {
      /* skip unreadable / invalid dictionaries */
    }
  }
  return shuffleInPlace(cards);
}

export function answersMatch(expected: string, given: string): boolean {
  return expected.trim().toLowerCase() === given.trim().toLowerCase();
}

export function practiceKindLabel(kind: PracticeKind): string {
  switch (kind) {
    case "toWord":
      return "Type the word";
    case "toTranslation":
      return "Type the translation";
    case "cloze":
      return "Fill the blank";
  }
}
