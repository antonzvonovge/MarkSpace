import { generateText } from "ai";
import {
  applyLexiconMoves,
  filterLexiconMoves,
  proposeLexiconReorg,
} from "./lexiconReorg";
import {
  credentialsFromSettings,
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";
import { markdownCoreRules } from "./markdownFormat";
import type { QuickTranslateResult } from "./quickTranslate";
import {
  collectFolderAbouts,
  withFolderContext,
} from "../lib/folderContext";
import { splitFrontmatter } from "../lib/noteFrontmatter";
import {
  collectLexiconMdPaths,
  formatLexiconFolderLoad,
  formatLexiconTreeForPrompt,
  patchLexiconGeneratedBody,
} from "../lib/lexiconNotes";
import {
  loadQuickTranslateCache,
  remapCachedNotePath,
  saveQuickTranslateCache,
  upsertCachedTranslation,
} from "../lib/quickTranslateCache";
import { helperModelCallParams, vaultChatModelId } from "../store/vaultAiSettingsStore";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { useBackgroundJobsStore } from "../store/backgroundJobsStore";
import { useVaultStore } from "../store/vaultStore";

const ERROR_HIDE_MS = 8000;
const errorHideTimers = new Map<string, number>();
const activeAbortByJob = new Map<string, AbortController>();

function lexiconArticleJobId(path: string): string {
  return `lexicon-article:${path}`;
}

function clearErrorHideTimer(jobId: string) {
  const prev = errorHideTimers.get(jobId);
  if (prev != null) {
    window.clearTimeout(prev);
    errorHideTimers.delete(jobId);
  }
}

function reportJob(
  jobId: string,
  patch: {
    label: string;
    progress: number;
    status: "running" | "error" | "done";
    detail?: string;
  },
) {
  clearErrorHideTimer(jobId);
  useBackgroundJobsStore.getState().upsertJob({
    id: jobId,
    label: patch.label,
    progress: patch.progress,
    status: patch.status,
    detail: patch.detail,
  });
  if (patch.status === "error") {
    const timer = window.setTimeout(() => {
      errorHideTimers.delete(jobId);
      useBackgroundJobsStore.getState().removeJob(jobId);
    }, ERROR_HIDE_MS);
    errorHideTimers.set(jobId, timer);
  }
}

export function sanitizeLexiconArticleMarkdown(
  raw: string,
  lemma: string,
): string {
  let text = raw.trim();
  const fence = /^```(?:markdown|md)?\s*([\s\S]*?)```$/i.exec(text);
  if (fence) text = fence[1]!.trim();
  const split = splitFrontmatter(text);
  if (split.hasFence) text = split.body.trim();
  text = text.replace(/^## Notes[ \t]*\n[\s\S]*$/m, "").trim();
  text = text.replace(/\n{3,}/g, "\n\n");
  if (!text) {
    return `# ${lemma}\n`;
  }
  if (!/^#\s+/m.test(text)) {
    text = `# ${lemma}\n\n${text}`;
  }
  return text;
}

function buildArticleSystem(params: {
  foreignLabel: string;
  foreignCode: string;
  nativeLabel: string;
  nativeCode: string;
  projectPath: string;
}): string {
  const core = markdownCoreRules()
    .map((line) => `- ${line}`)
    .join("\n");
  return `You write a **study note** for one ${params.foreignLabel} lemma in MarkSpace — a teacher's notebook page, not a dry glossary dump and not a Wikipedia article.

The headword is ${params.foreignLabel} (${params.foreignCode}). The reader is a ${params.nativeLabel} (${params.nativeCode}) speaker. Explanations and glosses: ${params.nativeLabel}. Headwords, inflections, example sentences, collocations, idioms: ${params.foreignLabel}.

This is a **vault note body**, not a chat reply: no YAML front-matter, no JSON, no ## Notes, no wrapping code fence, no ![[Note.md]] embeds, no invented .assets/ or .drawio paths.

MarkSpace markdown (must follow):
${core}

Layout that actually looks good in Live preview:
- Exactly one blank line between headings/paragraphs/lists/tables. Never two blank lines. Never a blank line between a parent * item and its nested children.
- Nested lists: * bullets, indent +2 spaces per depth.
- Bold labels on the same line: * **Register:** Formal — …
- GFM pipe tables for paradigms, UK/US pronunciation, collocations (chunk | meaning), contrast of near-synonyms. Never ASCII box tables, never a table inside a plain fence.
- Wiki-links: EVERY related ${params.foreignLabel} lemma you name as a headword (synonyms, antonyms, word-family, the Word column of a contrast table) MUST be a wiki-link [[${params.projectPath}/Lexicon/lemma|lemma]] — no .md, no [[Note#heading]]. Always link, even if that note does not exist yet (it will look broken until created). Do not leave those words as plain bold. Do not link ordinary running-text words inside example sentences.
- Optional: a small fenced \`\`\`d2 word-family sketch if it clarifies derivation — quote labels that contain parentheses.

Do **not** write walls of numbered 1. 2. 3. senses in one paragraph, and do **not** prefix asides with "Russian note:" / "Part of speech:". Nest instead.

Make it memorable: 1–2 sharp usage contrasts, real collocations, mistakes ${params.nativeLabel} speakers actually make, idioms only if they are common. Skip empty sections. Skip etymology unless it unlocks a meaning.

Suggested skeleton (adapt, omit empty):

# lemma
One tight ${params.nativeLabel} line: POS + core gloss.

## Pronunciation

| | |
| --- | --- |
| UK / US | IPA |
| Stress | … |

## Grammar

Paradigm as a table. Then * bullets for patterns (*register **for** a course*).

## Meanings

* **Verb — gloss** (Neutral / Formal)
  * When to use it (${params.nativeLabel}).
  * Example in ${params.foreignLabel}
    * ${params.nativeLabel} gloss
* **Noun — gloss** (domain)

## Collocations

| Chunk | Meaning |
| --- | --- |
| register a complaint | … |

## Idioms and phrases
* **ring a bell** — …

## Related words
* Synonyms: [[${params.projectPath}/Lexicon/enroll|enroll]], [[${params.projectPath}/Lexicon/sign-up|sign up]]
* Contrast table — Word column is always wiki-links, never bare bold:

| Word | Nuance |
| --- | --- |
| [[${params.projectPath}/Lexicon/boost|boost]] | … |

## Usage
Opinionated: when this word beats a synonym; false friends.

## Common mistakes
* **Wrong:** …
  * **Right:** … — why (${params.nativeLabel})`;
}

export async function generateLexiconArticle(params: {
  result: QuickTranslateResult;
  foreignLanguageCode: string;
  foreignLanguageLabel: string;
  nativeLanguageCode: string;
  nativeLanguageLabel: string;
  projectPath: string;
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: number, detail?: string) => void;
}): Promise<string> {
  const lemma = params.result.lemma.trim() || params.result.query.trim();
  params.onProgress?.(15, "Writing article");
  const senses = params.result.senses
    .map((s) => [s.pos, s.meaning].filter(Boolean).join(" — "))
    .filter(Boolean)
    .join("; ");
  const prompt = `Lemma: ${lemma}
Query: ${params.result.query}
Query language: ${params.result.queryLang}
Head translation: ${params.result.translation}
Transcript: ${params.result.transcript || "—"}
Forms: ${params.result.forms.join(", ") || "—"}
Synonyms (from quick lookup): ${params.result.synonyms.join(", ") || "—"}
Senses (from quick lookup): ${senses || "—"}

Write the study note in MarkSpace markdown. Every synonym / antonym / related lemma / Word-column headword must be a wiki-link [[${params.projectPath}/Lexicon/lemma|lemma]].`;

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { projectPropertiesByPath } = useVaultStore.getState();
    const system = withFolderContext(
      buildArticleSystem({
        foreignLabel: params.foreignLanguageLabel,
        foreignCode: params.foreignLanguageCode,
        nativeLabel: params.nativeLanguageLabel,
        nativeCode: params.nativeLanguageCode,
        projectPath: params.projectPath,
      }),
      collectFolderAbouts(
        [params.projectPath],
        projectPropertiesByPath,
      ),
    );
    const { text } = await generateText({
      model: resolved.model,
      system,
      prompt,
      maxOutputTokens: 5000,
      temperature: 0.45,
      abortSignal: params.abortSignal,
    });
    return sanitizeLexiconArticleMarkdown(text, lemma);
  };

  const article = await runWithModelFallback({
    keys: params.keys,
    modelId: params.modelId,
    fallbackModelId: params.fallbackModelId,
    run: tryModel,
  });
  params.onProgress?.(70, "Saving article");
  return article;
}

export type StartLexiconArticleJobParams = {
  notePath: string;
  projectPath: string;
  result: QuickTranslateResult;
  foreignLanguageCode: string;
  foreignLanguageLabel: string;
  nativeLanguageCode: string;
  nativeLanguageLabel: string;
};

/**
 * Fire-and-forget: write a full lexicon article, then optionally reorganize folders.
 * Progress shows in the bottom status bar. Does not open the note.
 */
export function startLexiconArticleJob(params: StartLexiconArticleJobParams): void {
  const path0 = params.notePath.trim();
  const lemma = params.result.lemma.trim() || params.result.query.trim();
  const jobId = lexiconArticleJobId(path0);
  const label = `Lexicon · ${lemma}`;

  activeAbortByJob.get(jobId)?.abort();
  const ac = new AbortController();
  activeAbortByJob.set(jobId, ac);

  void (async () => {
    reportJob(jobId, {
      label,
      progress: 5,
      status: "running",
      detail: "Starting",
    });
    try {
      const aiSettings = useAiSettingsStore.getState().settings;
      const helper = helperModelCallParams();
      const keys = credentialsFromSettings(aiSettings);
      const article = await generateLexiconArticle({
        result: params.result,
        foreignLanguageCode: params.foreignLanguageCode,
        foreignLanguageLabel: params.foreignLanguageLabel,
        nativeLanguageCode: params.nativeLanguageCode,
        nativeLanguageLabel: params.nativeLanguageLabel,
        projectPath: params.projectPath,
        keys,
        modelId: vaultChatModelId(),
        fallbackModelId: helper.modelId,
        abortSignal: ac.signal,
        onProgress: (progress, detail) => {
          if (ac.signal.aborted) return;
          reportJob(jobId, { label, progress, status: "running", detail });
        },
      });
      if (ac.signal.aborted) {
        useBackgroundJobsStore.getState().removeJob(jobId);
        return;
      }

      let notePath = path0;
      await patchLexiconGeneratedBody(
        notePath,
        params.result,
        params.foreignLanguageCode,
        article,
      );

      reportJob(jobId, {
        label,
        progress: 80,
        status: "running",
        detail: "Organizing lexicon",
      });
      await useVaultStore.getState().refreshTree();
      const tree = useVaultStore.getState().tree;
      const proposed = await proposeLexiconReorg({
        projectPath: params.projectPath,
        languageLabel: params.foreignLanguageLabel,
        lemma,
        treeListing: formatLexiconTreeForPrompt(tree, params.projectPath),
        folderLoad: formatLexiconFolderLoad(tree, params.projectPath),
        keys,
        modelId: helper.modelId,
        fallbackModelId: helper.fallbackModelId,
        abortSignal: ac.signal,
      });
      if (ac.signal.aborted) {
        useBackgroundJobsStore.getState().removeJob(jobId);
        return;
      }
      const occupied = collectLexiconMdPaths(tree, params.projectPath);
      const { accepted } = filterLexiconMoves(
        proposed,
        params.projectPath,
        occupied,
      );
      const { done } = await applyLexiconMoves(accepted);
      let cache = await loadQuickTranslateCache();
      for (const move of done) {
        cache = remapCachedNotePath(cache, move.from, move.to);
        if (move.from === notePath) notePath = move.to;
      }
      cache = upsertCachedTranslation(
        cache,
        params.foreignLanguageCode,
        params.nativeLanguageCode,
        params.result,
        notePath,
      );
      await saveQuickTranslateCache(cache);
      if (done.length > 0) await useVaultStore.getState().refreshTree();

      reportJob(jobId, {
        label: `Lexicon · ${lemma}`,
        progress: 100,
        status: "done",
        detail: done.length > 0 ? `Saved · ${done.length} moved` : "Saved",
      });
    } catch (err) {
      if (ac.signal.aborted) {
        useBackgroundJobsStore.getState().removeJob(jobId);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      reportJob(jobId, {
        label,
        progress: 0,
        status: "error",
        detail: msg || "Lexicon article failed",
      });
    } finally {
      if (activeAbortByJob.get(jobId) === ac) {
        activeAbortByJob.delete(jobId);
      }
    }
  })();
}
