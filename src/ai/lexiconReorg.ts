import { generateText } from "ai";
import {
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";
import {
  LEXICON_MAX_FOLDER_DEPTH,
  normalizeVaultRel,
  resolveLexiconMovePath,
  type LexiconMove,
  validateLexiconMove,
} from "../lib/lexiconNotes";
import { withVaultFolderContext } from "../lib/folderContext";
import { renamePath } from "../lib/vaultApi";

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error("Model did not return JSON");
  }
}

export function parseLexiconMoves(raw: string): LexiconMove[] {
  const parsed = extractJsonObject(raw) as { moves?: unknown };
  if (!Array.isArray(parsed.moves)) return [];
  const out: LexiconMove[] = [];
  for (const item of parsed.moves) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { from?: unknown; to?: unknown };
    const from = typeof rec.from === "string" ? rec.from.trim() : "";
    const to = typeof rec.to === "string" ? rec.to.trim() : "";
    if (!from || !to) continue;
    out.push({ from, to });
  }
  return out;
}

export function filterLexiconMoves(
  moves: LexiconMove[],
  projectPath: string,
  occupied: Iterable<string>,
): { accepted: LexiconMove[]; warnings: string[] } {
  const occupiedSet = new Set(
    [...occupied].map((p) => normalizeVaultRel(p)),
  );
  const accepted: LexiconMove[] = [];
  const warnings: string[] = [];
  for (const move of moves) {
    const from = resolveLexiconMovePath(move.from, projectPath);
    const to = resolveLexiconMovePath(move.to, projectPath);
    const err = validateLexiconMove({ from, to }, projectPath, occupiedSet);
    if (err === "no-op") continue;
    if (err) {
      warnings.push(`${from} → ${to}: ${err}`);
      continue;
    }
    occupiedSet.delete(from);
    occupiedSet.add(to);
    accepted.push({ from, to });
  }
  return { accepted, warnings };
}

function buildSystem(languageLabel: string, projectPath: string): string {
  return withVaultFolderContext(
    `You are a language-learning tutor reviewing the Lexicon folder for ${languageLabel} in a notes vault.
Your job is to DECIDE whether any files should move. Restructuring is optional. Empty moves is the default and often the right answer.

Decide from:
1. Learning goals of this project — the folder/project "about" text in the context below. If there is no description, use general pedagogy for learning ${languageLabel} (useful groupings the learner can scan: themes, word class, course topics — only when that actually helps study).
2. Folder load — how many notes sit in each directory. Split a crowded folder when it becomes hard to browse; do not invent deep trees for a handful of words. Merge or leave flat when folders would be nearly empty.
3. The words themselves — related lemmas belong together; a new word may join an existing group or stay put.

Reply with JSON only:
{"moves":[{"from":"project/Lexicon/old.md","to":"project/Lexicon/category/sub/lemma.md"}]}

Rules:
- Prefer {"moves":[]}. Move only when it clearly helps learning or browsing.
- Do not reshuffle for neatness, POS orthodoxy, or "while we are here".
- from and to are vault-relative paths to .md files already in the tree (or the new card path given in the prompt).
- Stay under that project's Lexicon/ folder.
- At most ${LEXICON_MAX_FOLDER_DEPTH} folders under Lexicon/ before the filename (example: Lexicon/verbs/motion/go.md).
- Do not invent files that are not listed. Do not delete. Never touch "## Notes" content (moves only).`,
    [projectPath],
  );
}

export async function proposeLexiconReorg(params: {
  projectPath: string;
  languageLabel: string;
  lemma: string;
  treeListing: string;
  folderLoad: string;
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
}): Promise<LexiconMove[]> {
  const prompt = `Project: ${params.projectPath}
Just saved lemma: ${params.lemma}

Folder load (notes per directory under Lexicon/):
${params.folderLoad}

Current files (relative to Lexicon/):
${params.treeListing}

If the layout already serves study and no folder is overloaded, return {"moves":[]}.`;

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: buildSystem(params.languageLabel, params.projectPath),
      prompt,
      maxOutputTokens: 2000,
      temperature: 0.2,
      abortSignal: params.abortSignal,
    });
    return parseLexiconMoves(text);
  };

  return await runWithModelFallback({
    keys: params.keys,
    modelId: params.modelId,
    fallbackModelId: params.fallbackModelId,
    run: tryModel,
  });
}

export async function applyLexiconMoves(
  moves: LexiconMove[],
): Promise<{ done: LexiconMove[]; warnings: string[] }> {
  const done: LexiconMove[] = [];
  const warnings: string[] = [];
  for (const move of moves) {
    try {
      const next = await renamePath(move.from, move.to);
      done.push({ from: move.from, to: next });
    } catch (e) {
      warnings.push(
        `${move.from} → ${move.to}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return { done, warnings };
}
