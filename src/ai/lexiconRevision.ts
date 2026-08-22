import {
  applyLexiconMoves,
  filterLexiconMoves,
  proposeLexiconReorg,
} from "./lexiconReorg";
import { credentialsFromSettings } from "./languageModel";
import { quickTranslateLanguageLabel } from "./quickTranslate";
import {
  collectLexiconMdPaths,
  formatLexiconFolderLoad,
  formatLexiconTreeForPrompt,
} from "../lib/lexiconNotes";
import {
  loadLexiconReorgState,
  markLexiconReorgStarted,
  projectsDueForLexiconReorg,
  saveLexiconReorgState,
  bumpLexiconLemmaCreated,
} from "../lib/lexiconReorgState";
import {
  loadQuickTranslateCache,
  remapCachedNotePath,
  saveQuickTranslateCache,
} from "../lib/quickTranslateCache";
import { helperModelCallParams } from "../store/vaultAiSettingsStore";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { useBackgroundJobsStore } from "../store/backgroundJobsStore";
import { useVaultStore } from "../store/vaultStore";

const ERROR_HIDE_MS = 8000;
const errorHideTimers = new Map<string, number>();
const activeAbortByJob = new Map<string, AbortController>();

function reorgJobId(projectPath: string): string {
  return `lexicon-reorg:${projectPath.replace(/^\/+|\/+$/g, "")}`;
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

function lexiconArticlesRunning(): boolean {
  return Object.values(useBackgroundJobsStore.getState().jobs).some(
    (j) => j.id.startsWith("lexicon-article:") && j.status === "running",
  );
}

function lexiconReorgRunning(projectPath: string): boolean {
  const job = useBackgroundJobsStore.getState().jobs[reorgJobId(projectPath)];
  return job?.status === "running";
}

function languageLabelForProject(projectPath: string): string {
  const props = useVaultStore.getState().projectPropertiesByPath[projectPath];
  const code = (props?.learningLanguage ?? "").trim() || projectPath;
  return quickTranslateLanguageLabel(code);
}

function startLexiconReorgJob(projectPath: string): void {
  const path = projectPath.replace(/^\/+|\/+$/g, "");
  if (!path || lexiconReorgRunning(path)) return;
  const jobId = reorgJobId(path);
  const label = `Lexicon review · ${path}`;

  activeAbortByJob.get(jobId)?.abort();
  const ac = new AbortController();
  activeAbortByJob.set(jobId, ac);

  void (async () => {
    reportJob(jobId, {
      label,
      progress: 8,
      status: "running",
      detail: "Reviewing folders",
    });
    try {
      let state = await loadLexiconReorgState();
      state = markLexiconReorgStarted(state, path);
      await saveLexiconReorgState(state);

      const aiSettings = useAiSettingsStore.getState().settings;
      const helper = helperModelCallParams();
      const keys = credentialsFromSettings(aiSettings);
      await useVaultStore.getState().refreshTree();
      const tree = useVaultStore.getState().tree;
      const proposed = await proposeLexiconReorg({
        projectPath: path,
        languageLabel: languageLabelForProject(path),
        treeListing: formatLexiconTreeForPrompt(tree, path),
        folderLoad: formatLexiconFolderLoad(tree, path),
        keys,
        modelId: helper.modelId,
        fallbackModelId: helper.fallbackModelId,
        abortSignal: ac.signal,
      });
      if (ac.signal.aborted) {
        useBackgroundJobsStore.getState().removeJob(jobId);
        return;
      }
      reportJob(jobId, {
        label,
        progress: 70,
        status: "running",
        detail: "Applying moves",
      });
      const occupied = collectLexiconMdPaths(tree, path);
      const { accepted } = filterLexiconMoves(proposed, path, occupied);
      const { done } = await applyLexiconMoves(accepted);
      let cache = await loadQuickTranslateCache();
      for (const move of done) {
        cache = remapCachedNotePath(cache, move.from, move.to);
      }
      await saveQuickTranslateCache(cache);
      if (done.length > 0) await useVaultStore.getState().refreshTree();

      reportJob(jobId, {
        label,
        progress: 100,
        status: "done",
        detail:
          done.length > 0
            ? `Reviewed · ${done.length} moved`
            : "Reviewed · no moves",
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
        detail: msg || "Lexicon review failed",
      });
    } finally {
      if (activeAbortByJob.get(jobId) === ac) {
        activeAbortByJob.delete(jobId);
      }
    }
  })();
}

/** After article jobs finish, start any due folder reviews. */
export async function maybeStartLexiconReorgs(): Promise<void> {
  if (lexiconArticlesRunning()) return;
  const state = await loadLexiconReorgState();
  for (const projectPath of projectsDueForLexiconReorg(state)) {
    if (!lexiconReorgRunning(projectPath)) startLexiconReorgJob(projectPath);
  }
}

/** Call when a new lemma `.md` is created (Quick Translate, later other entry points). */
export async function recordLexiconLemmaCreated(
  projectPath: string,
): Promise<void> {
  const key = projectPath.replace(/^\/+|\/+$/g, "");
  if (!key) return;
  const next = bumpLexiconLemmaCreated(await loadLexiconReorgState(), key);
  await saveLexiconReorgState(next);
}
