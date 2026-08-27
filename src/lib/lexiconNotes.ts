import {
  dictHeadwordLang,
  type QuickTranslateResult,
} from "../ai/quickTranslate";
import { vaultProjectRootOf } from "./diaryNotes";
import {
  mergeFrontmatter,
  splitFrontmatter,
  type FrontmatterData,
} from "./noteFrontmatter";
import { normalizeTranslateSurface } from "./quickTranslateCache";
import {
  createNote,
  ensureFolder,
  readNote,
  writeNote,
  type ProjectProperties,
  type TreeNode,
} from "./vaultApi";
import { useVaultStore } from "../store/vaultStore";

export const LEXICON_FOLDER = "Lexicon";
export const LEXICON_NOTES_HEADING = "## Notes";
/** Folders under Lexicon/, not counting the .md file. */
export const LEXICON_MAX_FOLDER_DEPTH = 2;
/** Path segments after Lexicon/ for a note: up to two folders + filename. */
export const LEXICON_MAX_MD_SEGMENTS = LEXICON_MAX_FOLDER_DEPTH + 1;

export type LexiconNoteHit = {
  path: string;
  lemma: string;
  hasExtraNotes: boolean;
};

export function lexiconRoot(projectPath: string): string {
  return `${projectPath.replace(/\/+$/g, "")}/${LEXICON_FOLDER}`;
}

/** Direct `{project}/Lexicon` folder (not nested category dirs). */
export function isVaultLexiconFolder(path: string, isDir: boolean): boolean {
  if (!isDir) return false;
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  return parts.length === 2 && parts[1]!.toLowerCase() === LEXICON_FOLDER.toLowerCase();
}

export function isLexiconNotePath(path: string, projectPath: string): boolean {
  const root = lexiconRoot(projectPath);
  const p = path.replace(/^\/+/g, "");
  return p === root || p.startsWith(`${root}/`);
}

/** Markdown lemma note under `{project}/Lexicon/…` (not `.folder.md`). */
export function isVaultLexiconMdNote(path: string): boolean {
  const p = path.replace(/^\/+|\/+$/g, "");
  if (!p.toLowerCase().endsWith(".md")) return false;
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 3 || parts.length > 2 + LEXICON_MAX_MD_SEGMENTS) {
    return false;
  }
  if (parts[1]!.toLowerCase() !== LEXICON_FOLDER.toLowerCase()) return false;
  const name = parts[parts.length - 1]!;
  return name.toLowerCase() !== ".folder.md";
}

export function lexiconMdSegments(path: string, projectPath: string): string[] | null {
  const root = lexiconRoot(projectPath);
  const prefix = `${root}/`;
  if (!path.startsWith(prefix) || !path.toLowerCase().endsWith(".md")) return null;
  const rest = path.slice(prefix.length);
  if (!rest || rest.includes("..")) return null;
  return rest.split("/").filter(Boolean);
}

/** Max whitespace-separated tokens for a Lexicon card (phrasal verbs / short chunks OK). */
export const LEXICON_MAX_WORDS = 4;

/**
 * Whether a Quick Translate query is short enough to save as a Lexicon lemma card.
 * Skips full sentences and long phrases; the translate dialog may still show a result.
 */
export function isLexiconWorthyQuery(text: string): boolean {
  const trimmed = text.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!trimmed) return false;
  if (/[.!?;]/.test(trimmed)) return false;
  const words = trimmed.split(" ").filter(Boolean);
  return words.length <= LEXICON_MAX_WORDS;
}

export function lexiconSlug(lemma: string): string {
  const trimmed = lemma.normalize("NFC").replace(/\s+/g, " ").trim();
  const slug = trimmed
    .replace(/[/\\]/g, "-")
    .replace(/[<>:"|?*]/g, "")
    .replace(/\.+$/g, "")
    .trim();
  return slug || "word";
}

/**
 * Learning-language headword for Lexicon filename / frontmatter `lemma`
 * (same side as .mddict headword — not the native-query citation form).
 */
export function lexiconHeadword(
  result: QuickTranslateResult,
  foreignLanguageCode: string,
  nativeLanguageCode: string,
): string {
  const headLang = dictHeadwordLang(nativeLanguageCode, foreignLanguageCode);
  const queryIsHead =
    result.queryLang.trim().toLowerCase() === headLang.trim().toLowerCase();
  if (queryIsHead) {
    return result.lemma.trim() || result.query.trim() || "word";
  }
  return (
    result.translation.trim() ||
    result.lemma.trim() ||
    result.query.trim() ||
    "word"
  );
}

export function pickLexiconProject(
  projects: Record<string, ProjectProperties>,
  foreignLanguageCode: string,
  activePath?: string | null,
): string | null {
  const foreign = foreignLanguageCode.trim().toLowerCase();
  if (!foreign) return null;
  const matches = Object.values(projects)
    .filter(
      (p) =>
        p.projectType === "languageLearning" &&
        (p.learningLanguage ?? "").trim().toLowerCase() === foreign,
    )
    .map((p) => p.path);
  if (matches.length === 0) return null;
  const activeRoot = activePath ? vaultProjectRootOf(activePath) : null;
  if (activeRoot && matches.includes(activeRoot)) return activeRoot;
  return [...matches].sort((a, b) => a.localeCompare(b))[0] ?? null;
}

export function splitLexiconBody(body: string): {
  generated: string;
  notes: string;
  hasExtraNotes: boolean;
} {
  const text = body.replace(/\r\n/g, "\n");
  const re = /^## Notes[ \t]*$/m;
  const match = re.exec(text);
  if (!match || match.index === undefined) {
    return {
      generated: text.trim(),
      notes: "",
      hasExtraNotes: false,
    };
  }
  const generated = text.slice(0, match.index).trim();
  const notes = text.slice(match.index + match[0].length).replace(/^\n/, "");
  return {
    generated,
    notes,
    hasExtraNotes: notes.trim().length > 0,
  };
}

export function assembleLexiconBody(generated: string, notes: string): string {
  const gen = generated.trim();
  const tail = notes.replace(/^\n+/, "").replace(/\n+$/g, "");
  if (!tail) return `${gen}\n\n${LEXICON_NOTES_HEADING}\n`;
  return `${gen}\n\n${LEXICON_NOTES_HEADING}\n\n${tail}\n`;
}

export function hasLexiconExtraNotes(markdown: string): boolean {
  const { body } = splitFrontmatter(markdown);
  return splitLexiconBody(body).hasExtraNotes;
}

function aliasesFromYaml(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" && typeof item !== "number") continue;
    const line = String(item).trim();
    const key = normalizeTranslateSurface(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function lexiconSurfacesFromMarkdown(markdown: string): string[] {
  const { data, body } = splitFrontmatter(markdown);
  const lemma =
    typeof data?.lemma === "string" ? data.lemma.trim() : "";
  const aliases = aliasesFromYaml(data?.aliases);
  const out = [...aliases];
  if (lemma) out.unshift(lemma);
  const stem = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (stem) out.push(stem);
  return out;
}

export function lemmaFromLexiconMarkdown(markdown: string, fallback: string): string {
  const { data } = splitFrontmatter(markdown);
  if (typeof data?.lemma === "string" && data.lemma.trim()) return data.lemma.trim();
  return fallback;
}

export function stubResultFromLexiconNote(
  markdown: string,
  path: string,
  foreignLang: string,
): QuickTranslateResult {
  const stem = path.replace(/^.*\//, "").replace(/\.md$/i, "") || "word";
  const lemma = lemmaFromLexiconMarkdown(markdown, stem);
  const aliases = aliasesFromYaml(splitFrontmatter(markdown).data?.aliases).filter(
    (a) =>
      normalizeTranslateSurface(a) !== normalizeTranslateSurface(lemma),
  );
  return {
    query: lemma,
    queryLang: foreignLang,
    lemma,
    transcript: "",
    translation: lemma,
    translationTranscript: "",
    didYouMean: "",
    forms: aliases,
    synonyms: [],
    senses: [],
    examples: [],
  };
}

export const LEXICON_ARTICLE_PENDING =
  "_Full article is being written in the background._";

export function buildLexiconMarkdown(
  existing: string | null,
  result: QuickTranslateResult,
  foreignLanguageCode: string,
  nativeLanguageCode: string,
  generatedBody?: string,
): string {
  const lemma = lexiconHeadword(result, foreignLanguageCode, nativeLanguageCode);
  const heading = `# ${lemma}`;
  const article = (generatedBody ?? LEXICON_ARTICLE_PENDING).trim();
  const generatedBlock = article.startsWith("#")
    ? article
    : `${heading}\n\n${article}`;
  let notes = "";
  let data: FrontmatterData = {};
  if (existing) {
    const split = splitFrontmatter(existing);
    data = { ...(split.data ?? {}) };
    notes = splitLexiconBody(split.body).notes;
  }
  data.lemma = lemma;
  data.lang = foreignLanguageCode.trim().toLowerCase();
  const aliasSet = new Set<string>();
  const aliases: string[] = [];
  const push = (raw: string) => {
    const line = raw.trim();
    const key = normalizeTranslateSurface(line);
    if (!key || key === normalizeTranslateSurface(lemma) || aliasSet.has(key)) {
      return;
    }
    aliasSet.add(key);
    aliases.push(line);
  };
  push(result.query);
  push(result.lemma);
  push(result.didYouMean);
  push(result.translation);
  for (const form of result.forms) push(form);
  data.aliases = aliases;
  return mergeFrontmatter(data, assembleLexiconBody(generatedBlock, notes));
}

function walkMd(node: TreeNode, out: string[]) {
  if (node.isDir) {
    for (const child of node.children ?? []) walkMd(child, out);
    return;
  }
  if (!node.path.toLowerCase().endsWith(".md")) return;
  const name = node.path.split("/").pop() ?? "";
  if (name.toLowerCase() === ".folder.md") return;
  out.push(node.path);
}

function findNode(tree: TreeNode | null | undefined, path: string): TreeNode | null {
  if (!tree) return null;
  if (tree.path === path) return tree;
  for (const child of tree.children ?? []) {
    const hit = findNode(child, path);
    if (hit) return hit;
  }
  return null;
}

export function collectLexiconMdPaths(
  tree: TreeNode | null | undefined,
  projectPath: string,
): string[] {
  const root = findNode(tree, lexiconRoot(projectPath));
  if (!root) return [];
  const out: string[] = [];
  walkMd(root, out);
  return out.sort((a, b) => a.localeCompare(b));
}

export function formatLexiconTreeForPrompt(
  tree: TreeNode | null | undefined,
  projectPath: string,
): string {
  const root = lexiconRoot(projectPath);
  const paths = collectLexiconMdPaths(tree, projectPath);
  if (paths.length === 0) return `(empty) ${root}/`;
  return paths.map((p) => p.slice(root.length + 1)).join("\n");
}

/** How many lemma notes sit in each directory under Lexicon/ (for the reorg model). */
export function formatLexiconFolderLoad(
  tree: TreeNode | null | undefined,
  projectPath: string,
): string {
  const root = lexiconRoot(projectPath);
  const paths = collectLexiconMdPaths(tree, projectPath);
  if (paths.length === 0) return `${root}/ — 0 notes`;
  const counts = new Map<string, number>();
  for (const path of paths) {
    const rel = path.slice(root.length + 1);
    const slash = rel.lastIndexOf("/");
    const dir = slash === -1 ? "(Lexicon root)" : rel.slice(0, slash);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dir, n]) => `${dir}: ${n}`)
    .join("\n");
}

export function lookupLexiconHit(
  hits: LexiconNoteHit[],
  query: string,
  surfacesByPath?: Map<string, string[]>,
): LexiconNoteHit | null {
  const key = normalizeTranslateSurface(query);
  if (!key) return null;
  for (const hit of hits) {
    const surfaces = surfacesByPath?.get(hit.path) ?? [hit.lemma];
    if (surfaces.some((s) => normalizeTranslateSurface(s) === key)) return hit;
    const stem = hit.path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    if (normalizeTranslateSurface(stem) === key) return hit;
  }
  return null;
}

export async function loadLexiconHits(
  tree: TreeNode | null | undefined,
  projectPath: string,
): Promise<{ hits: LexiconNoteHit[]; surfacesByPath: Map<string, string[]> }> {
  const paths = collectLexiconMdPaths(tree, projectPath);
  const hits: LexiconNoteHit[] = [];
  const surfacesByPath = new Map<string, string[]>();
  for (const path of paths) {
    try {
      const markdown = await readNote(path);
      const lemma = lemmaFromLexiconMarkdown(
        markdown,
        path.split("/").pop()?.replace(/\.md$/i, "") ?? "",
      );
      const { body } = splitFrontmatter(markdown);
      hits.push({
        path,
        lemma,
        hasExtraNotes: splitLexiconBody(body).hasExtraNotes,
      });
      surfacesByPath.set(path, lexiconSurfacesFromMarkdown(markdown));
    } catch {
      /* skip unreadable */
    }
  }
  return { hits, surfacesByPath };
}

function syncOpenTab(path: string, text: string) {
  const store = useVaultStore.getState();
  store.markExternalWrite();
  store.applyExternalContent(path, text, { force: true });
}

export async function upsertLexiconNote(params: {
  projectPath: string;
  existingPath?: string | null;
  result: QuickTranslateResult;
  foreignLanguageCode: string;
  nativeLanguageCode: string;
  generatedBody?: string;
}): Promise<{ path: string; created: boolean; hasExtraNotes: boolean }> {
  const lemma = lexiconHeadword(
    params.result,
    params.foreignLanguageCode,
    params.nativeLanguageCode,
  );
  const desired = params.existingPath?.trim()
    ? params.existingPath.trim()
    : `${lexiconRoot(params.projectPath)}/${lexiconSlug(lemma)}.md`;

  await ensureFolder(lexiconRoot(params.projectPath));

  let existing: string | null = null;
  let created = false;
  try {
    existing = await readNote(desired);
  } catch {
    existing = null;
  }
  if (existing == null) {
    try {
      await createNote(desired);
      created = true;
      existing = await readNote(desired);
    } catch {
      existing = await readNote(desired).catch(() => null);
    }
  }

  const next = buildLexiconMarkdown(
    existing,
    params.result,
    params.foreignLanguageCode,
    params.nativeLanguageCode,
    params.generatedBody,
  );
  const store = useVaultStore.getState();
  store.markExternalWrite();
  const saved = await writeNote(desired, next);
  syncOpenTab(desired, saved);
  void store.refreshTree();
  return {
    path: desired,
    created,
    hasExtraNotes: hasLexiconExtraNotes(saved),
  };
}

export async function patchLexiconGeneratedBody(
  path: string,
  result: QuickTranslateResult,
  foreignLanguageCode: string,
  nativeLanguageCode: string,
  generatedBody: string,
): Promise<string> {
  const existing = await readNote(path);
  const next = buildLexiconMarkdown(
    existing,
    result,
    foreignLanguageCode,
    nativeLanguageCode,
    generatedBody,
  );
  const store = useVaultStore.getState();
  store.markExternalWrite();
  const saved = await writeNote(path, next);
  syncOpenTab(path, saved);
  return saved;
}

export type LexiconMove = { from: string; to: string };

export function normalizeVaultRel(path: string): string {
  return path.replace(/^\/+/g, "").replace(/\\/g, "/").trim();
}

export function resolveLexiconMovePath(path: string, projectPath: string): string {
  const n = normalizeVaultRel(path);
  const root = lexiconRoot(projectPath);
  if (n.startsWith(`${projectPath}/`)) return n;
  if (n.startsWith(`${LEXICON_FOLDER}/`)) return `${projectPath}/${n}`;
  if (n.toLowerCase().endsWith(".md") && !n.includes("/")) {
    return `${root}/${n}`;
  }
  return n.startsWith(root) ? n : `${root}/${n}`;
}

export function validateLexiconMove(
  move: LexiconMove,
  projectPath: string,
  occupied: Set<string>,
): string | null {
  const from = normalizeVaultRel(move.from);
  const to = normalizeVaultRel(move.to);
  if (!from.toLowerCase().endsWith(".md") || !to.toLowerCase().endsWith(".md")) {
    return "Only markdown notes can be moved";
  }
  if (from.includes("..") || to.includes("..")) return "Invalid path";
  if (!isLexiconNotePath(from, projectPath) || !isLexiconNotePath(to, projectPath)) {
    return "Move must stay inside Lexicon";
  }
  const segs = lexiconMdSegments(to, projectPath);
  if (!segs || segs.length < 1 || segs.length > LEXICON_MAX_MD_SEGMENTS) {
    return "Lexicon folder depth exceeded";
  }
  if (from === to) return "no-op";
  if (occupied.has(to)) return "Target already exists";
  return null;
}
