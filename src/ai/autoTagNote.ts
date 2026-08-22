import { generateText } from "ai";
import { extractInlineTags } from "../lib/hashtagMarkdown";
import { getNoteTags, setNoteTags, splitFrontmatter } from "../lib/noteFrontmatter";
import { resolveSuggestedTags } from "../lib/tagName";
import { withVaultFolderContext } from "../lib/folderContext";
import { listVaultTags, readNote, writeNote } from "../lib/vaultApi";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { helperModelCallParams } from "../store/vaultAiSettingsStore";
import { useBackgroundJobsStore } from "../store/backgroundJobsStore";
import { useVaultStore } from "../store/vaultStore";
import {
  credentialsFromSettings,
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";

/** Cheap model — same class as chat titles / link tags. */
const MAX_SOURCE_CHARS = 24_000;
const MAX_CATALOG = 500;
const MAX_TAGS = 4;
const ERROR_HIDE_MS = 8_000;

const activeAbortByJob = new Map<string, AbortController>();
const errorHideTimers = new Map<string, number>();

export type AutoTagNoteParams = {
  sourcePath: string;
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: number, detail?: string) => void;
};

export type AutoTagNoteResult = {
  path: string;
  tags: string[];
  added: string[];
};

function noteStem(path: string): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

export function autoTagJobId(sourcePath: string): string {
  return `auto-tag:${sourcePath}`;
}

function extractJsonValue(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const objStart = body.indexOf("{");
    const objEnd = body.lastIndexOf("}");
    if (objStart >= 0 && objEnd > objStart) {
      try {
        return JSON.parse(body.slice(objStart, objEnd + 1));
      } catch {
        /* fall through to array */
      }
    }
    const arrStart = body.indexOf("[");
    const arrEnd = body.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      return JSON.parse(body.slice(arrStart, arrEnd + 1));
    }
    throw new Error("Model did not return JSON");
  }
}

function tagsFromModelOutput(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const tags = (raw as { tags?: unknown }).tags;
    if (Array.isArray(tags)) return tags;
  }
  return [];
}

function uniqueLower(tags: string[]): Set<string> {
  return new Set(tags.map((t) => t.toLowerCase()));
}

function mergeTags(existing: string[], suggested: string[], max = MAX_TAGS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...suggested, ...existing]) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

function buildSystem(tagCatalog: string[], notePath: string): string {
  const catalogLine =
    tagCatalog.length > 0
      ? `Existing vault tags (prefer these exact strings when they fit): ${JSON.stringify(tagCatalog)}`
      : `The vault has no tags yet — invent 1–${MAX_TAGS} short lowercase kebab-case tags.`;
  return withVaultFolderContext(
    `You assign page tags for a markdown note in a personal knowledge base.
Reply with JSON only, no markdown fences: {"tags":["..."]}
- Pick 1–${MAX_TAGS} tags that describe the note's topics, not a summary. Never more than ${MAX_TAGS}.
- Prefer exact names from the existing vault catalog when they fit. Do not invent a near-duplicate of a catalog tag (e.g. use "multi-agent" not "multiagent" if the catalog has the former).
- Invent a new tag only when nothing in the catalog covers that topic.
- Tag syntax: no leading #, no spaces. Multi-word tags in kebab-case (e.g. "model-context-protocol"), lowercase, only letters/digits/-/_ and optional nesting with / (e.g. "project/markspace").
- Keep existing note tags that still fit; omit ones that do not.
- Do not tag with generic filler (note, ideas, misc) unless that is an existing catalog tag and clearly right.
${catalogLine}`,
    [notePath],
  );
}

function buildPrompt(opts: {
  path: string;
  existingTags: string[];
  inlineTags: string[];
  body: string;
}): string {
  const lines = [`Path: ${opts.path}`];
  if (opts.existingTags.length > 0) {
    lines.push(`Current frontmatter tags: ${JSON.stringify(opts.existingTags)}`);
  } else {
    lines.push("Current frontmatter tags: (none)");
  }
  if (opts.inlineTags.length > 0) {
    lines.push(`Inline #tags in the body: ${JSON.stringify(opts.inlineTags)}`);
  }
  const body = opts.body.trim()
    ? opts.body
    : "(empty body — tag from the path and title only)";
  lines.push("", "Note body:", body);
  return lines.join("\n");
}

async function loadSourceMarkdown(
  sourcePath: string,
  preferEditor: boolean,
): Promise<string> {
  if (preferEditor) {
    const { activePath, content } = useVaultStore.getState();
    if (activePath === sourcePath && typeof content === "string") {
      return content;
    }
  }
  return readNote(sourcePath);
}

async function loadCatalog(): Promise<string[]> {
  try {
    const tags = await listVaultTags();
    if (tags.length > 0) return tags;
  } catch {
    /* fall back to the in-memory catalog */
  }
  return useVaultStore.getState().vaultTags;
}

export async function suggestNoteTags(params: {
  path: string;
  markdown: string;
  catalog: string[];
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
}): Promise<string[]> {
  const { body } = splitFrontmatter(params.markdown);
  const existingTags = getNoteTags(params.markdown);
  const inlineTags = extractInlineTags(body);
  const catalog = params.catalog
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_CATALOG);
  const clippedBody =
    body.length > MAX_SOURCE_CHARS
      ? `${body.slice(0, MAX_SOURCE_CHARS)}\n…`
      : body;

  const prompt = buildPrompt({
    path: params.path,
    existingTags,
    inlineTags,
    body: clippedBody,
  });

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: buildSystem(catalog, params.path),
      prompt,
      maxOutputTokens: 220,
      temperature: 0.2,
      abortSignal: params.abortSignal,
    });
    return resolveSuggestedTags(tagsFromModelOutput(extractJsonValue(text)), catalog, MAX_TAGS);
  };

  return await runWithModelFallback({
    keys: params.keys,
    modelId: params.modelId,
    fallbackModelId: params.fallbackModelId,
    run: tryModel,
  });
}

/**
 * Suggest tags from note content and write them to YAML frontmatter.
 * Uses the editor buffer when the note is open. Re-reads at save so concurrent
 * body edits are kept; existing frontmatter tags are never removed.
 */
export async function autoTagNote(
  params: AutoTagNoteParams,
): Promise<AutoTagNoteResult> {
  const sourcePath = params.sourcePath.trim();
  if (!sourcePath.toLowerCase().endsWith(".md")) {
    throw new Error("Only markdown notes can be auto-tagged");
  }

  params.onProgress?.(8, "Reading note");
  const content = await loadSourceMarkdown(sourcePath, true);
  if (params.abortSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  params.onProgress?.(18, "Loading tag catalog");
  const catalog = await loadCatalog();
  if (params.abortSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  params.onProgress?.(30, "Suggesting tags");
  const suggested = await suggestNoteTags({
    path: sourcePath,
    markdown: content,
    catalog,
    keys: params.keys,
    modelId: params.modelId,
    fallbackModelId: params.fallbackModelId,
    abortSignal: params.abortSignal,
  });
  if (params.abortSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  params.onProgress?.(88, "Saving tags");
  const latest = await loadSourceMarkdown(sourcePath, true);
  const existing = getNoteTags(latest);
  const tags = mergeTags(existing, suggested);
  if (tags.length === 0) {
    throw new Error("No tags suggested");
  }

  const next = setNoteTags(latest, tags);
  const applied = getNoteTags(next);
  const appliedKeys = uniqueLower(applied);
  const missing = tags.filter((t) => !appliedKeys.has(t.toLowerCase()));
  if (missing.length > 0) {
    throw new Error("Could not update tags (unparseable frontmatter)");
  }

  const before = uniqueLower(existing);
  const added = tags.filter((t) => !before.has(t.toLowerCase()));
  if (added.length === 0) {
    params.onProgress?.(100, tags.join(", ") || "no new tags");
    return { path: sourcePath, tags, added };
  }

  const saved = await writeNote(sourcePath, next);
  const vault = useVaultStore.getState();
  if (vault.activePath === sourcePath) {
    window.setTimeout(() => {
      const current = useVaultStore.getState();
      if (current.activePath !== sourcePath) return;
      current.applyExternalContent(sourcePath, saved, { force: true });
      current.markExternalWrite();
    }, 0);
  }
  void vault.refreshVaultTags();

  params.onProgress?.(100, tags.join(", ") || "done");
  return { path: sourcePath, tags, added };
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

/**
 * Awaitable auto-tag with status-bar progress (command palette + agent tool).
 * Re-invoking for the same note cancels the previous run.
 */
export async function autoTagNoteWithJob(params: {
  sourcePath: string;
}): Promise<AutoTagNoteResult> {
  const path = params.sourcePath.trim();
  if (!path.toLowerCase().endsWith(".md")) {
    throw new Error("Only markdown notes can be auto-tagged");
  }

  const jobId = autoTagJobId(path);
  const name = noteStem(path);
  const label = `Tagging ${name}`;

  activeAbortByJob.get(jobId)?.abort();
  const ac = new AbortController();
  activeAbortByJob.set(jobId, ac);

  reportJob(jobId, {
    label,
    progress: 0,
    status: "running",
    detail: "Starting",
  });

  try {
    const aiSettings = useAiSettingsStore.getState().settings;
    const helper = helperModelCallParams();
    const result = await autoTagNote({
      sourcePath: path,
      keys: credentialsFromSettings(aiSettings),
      modelId: helper.modelId,
      fallbackModelId: helper.fallbackModelId,
      abortSignal: ac.signal,
      onProgress: (progress, detail) => {
        if (ac.signal.aborted) return;
        reportJob(jobId, {
          label,
          progress,
          status: "running",
          detail,
        });
      },
    });
    if (ac.signal.aborted) {
      useBackgroundJobsStore.getState().removeJob(jobId);
      throw new Error("Auto-tag cancelled");
    }
    const detail =
      result.added.length > 0
        ? result.added.join(", ")
        : result.tags.join(", ") || "no new tags";
    reportJob(jobId, {
      label: `Tagged ${name}`,
      progress: 100,
      status: "done",
      detail,
    });
    return result;
  } catch (err) {
    if (ac.signal.aborted) {
      useBackgroundJobsStore.getState().removeJob(jobId);
      throw err instanceof Error ? err : new Error("Auto-tag cancelled");
    }
    const msg = err instanceof Error ? err.message : String(err);
    reportJob(jobId, {
      label: `Tag ${name}`,
      progress: 0,
      status: "error",
      detail: msg || "Auto-tag failed",
    });
    throw err;
  } finally {
    if (activeAbortByJob.get(jobId) === ac) {
      activeAbortByJob.delete(jobId);
    }
  }
}

/** Fire-and-forget: progress appears in the bottom status bar. */
export function startAutoTagNote(sourcePath: string): void {
  void autoTagNoteWithJob({ sourcePath }).catch(() => {
    /* error already shown in status bar */
  });
}

/** Tag the currently open markdown note. No-op errors land in the status bar. */
export function startAutoTagActiveNote(): void {
  const path = useVaultStore.getState().activePath?.trim() ?? "";
  if (!path) {
    reportJob("auto-tag:active", {
      label: "Auto-tag note",
      progress: 0,
      status: "error",
      detail: "Open a markdown note first",
    });
    return;
  }
  if (!path.toLowerCase().endsWith(".md")) {
    reportJob(autoTagJobId(path), {
      label: "Auto-tag note",
      progress: 0,
      status: "error",
      detail: "Only markdown notes can be auto-tagged",
    });
    return;
  }
  startAutoTagNote(path);
}

/** @internal exported for unit tests */
export const _test = {
  extractJsonValue,
  tagsFromModelOutput,
  mergeTags,
  buildSystem,
  buildPrompt,
  noteStem,
};
