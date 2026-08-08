import { streamText } from "ai";
import { extractInlineTags } from "../lib/hashtagMarkdown";
import { splitFrontmatter } from "../lib/noteFrontmatter";
import {
  createNote,
  joinPath,
  parentPath,
  readNote,
  writeNote,
} from "../lib/vaultApi";
import {
  nativeLanguageFileCode,
  nativeLanguageLabel,
  type NativeLanguageId,
} from "../settings/types";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { useBackgroundJobsStore } from "../store/backgroundJobsStore";
import { usePrefsStore } from "../store/prefsStore";
import { useVaultStore } from "../store/vaultStore";
import {
  credentialsFromSettings,
  hasCredentialsForModel,
  missingCredentialsMessage,
  resolveLanguageModel,
  type AiProviderCredentials,
} from "./languageModel";

/** Prefer a fast model; fall back to the user's chat model. */
const TRANSLATE_MODEL = "openai/gpt-4.1-mini";
const MAX_SOURCE_CHARS = 80_000;
const TAG_PLACEHOLDER_RE = /⟦MS_TAG_(\d+)⟧/g;
const ERROR_HIDE_MS = 8_000;

const activeAbortByJob = new Map<string, AbortController>();
const errorHideTimers = new Map<string, number>();

export type TranslateNoteParams = {
  sourcePath: string;
  targetLanguage: NativeLanguageId;
  keys: AiProviderCredentials;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: number, detail?: string) => void;
};

export type TranslateNoteResult = {
  path: string;
  language: NativeLanguageId;
};

function noteStem(path: string): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

function noteDisplayName(path: string): string {
  return noteStem(path);
}

/** Sibling path: `Folder/Note.md` + `ru` → `Folder/Note.RU.md`. */
export function translatedSiblingPath(
  sourcePath: string,
  language: NativeLanguageId,
): string {
  const folder = parentPath(sourcePath);
  const stem = noteStem(sourcePath);
  const code = nativeLanguageFileCode(language);
  return joinPath(folder, `${stem}.${code}.md`);
}

export function translateJobId(sourcePath: string): string {
  return `translate:${sourcePath}`;
}

function stripOuterFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return fence ? fence[1]!.trimEnd() : trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mask inline `#tags` so the model cannot rename/translate them.
 * Frontmatter is handled separately (never sent to the model).
 */
export function protectInlineTags(body: string): {
  text: string;
  restore: (translated: string) => string;
} {
  const tags = extractInlineTags(body);
  if (tags.length === 0) {
    return { text: body, restore: (s) => s };
  }

  const sorted = [...tags].sort((a, b) => b.length - a.length);
  let text = body;
  for (let i = 0; i < sorted.length; i++) {
    const name = sorted[i]!;
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}_/-])#(${escapeRegExp(name)})(?![\\p{L}\\p{N}_/-])`,
      "gu",
    );
    text = text.replace(re, `$1⟦MS_TAG_${i}⟧`);
  }

  return {
    text,
    restore: (translated: string) =>
      translated.replace(TAG_PLACEHOLDER_RE, (_m, idx: string) => {
        const name = sorted[Number(idx)];
        return name ? `#${name}` : _m;
      }),
  };
}

/** Reattach the original YAML fence verbatim; drop any fence the model invented. */
export function joinWithOriginalFrontmatter(
  originalMarkdown: string,
  translatedBody: string,
): string {
  const body = splitFrontmatter(translatedBody).hasFence
    ? splitFrontmatter(translatedBody).body
    : translatedBody;
  const split = splitFrontmatter(originalMarkdown);
  if (!split.hasFence) return body;
  return `---\n${split.rawYaml ?? ""}\n---\n${body.replace(/^\uFEFF?/, "")}`;
}

function buildSystem(language: NativeLanguageId): string {
  const label = nativeLanguageLabel(language);
  return `You translate Markdown note bodies for a personal knowledge base.
Reply with ONLY the translated Markdown body — no preamble, no explanation, no wrapping code fences, and no YAML front-matter (it was removed on purpose).

Target language: ${label} (${language}).

Do NOT translate or alter:
- Placeholders like ⟦MS_TAG_0⟧ — copy them exactly (they are vault tags)
- Any remaining #tag tokens
- Wiki-link targets/paths ([[Note]], [[folder/note|Alias]] — you may translate only the display alias after |)
- Image/asset paths and Draw.io embeds (![[…]], ![alt](path) — translate alt text only)
- Fenced code block contents (mermaid/plantuml/d2/dot/markmap/source); keep code as-is
- URLs and HTML attributes (including data-background-color / data-text-color)

Do translate natural-language content: headings, paragraphs, lists, table cell text, image alt text, and link labels.`;
}

async function createNoteUnique(desiredPath: string): Promise<string> {
  const normalized = desiredPath.toLowerCase().endsWith(".md")
    ? desiredPath
    : `${desiredPath}.md`;
  const dot = normalized.lastIndexOf(".");
  const stem = normalized.slice(0, dot);
  const ext = normalized.slice(dot);

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate =
      attempt === 0 ? normalized : `${stem}-${attempt + 1}${ext}`;
    try {
      return await createNote(candidate);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already exists/i.test(msg)) throw e;
    }
  }
  throw new Error(`Could not create a unique note path near ${normalized}`);
}

async function translateMarkdownBody(params: {
  body: string;
  targetLanguage: NativeLanguageId;
  keys: AiProviderCredentials;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: number) => void;
}): Promise<string> {
  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const estimate = Math.max(params.body.length, 400);
    let received = 0;
    let lastReported = 20;

    const result = streamText({
      model: resolved.model,
      system: buildSystem(params.targetLanguage),
      prompt: params.body,
      maxOutputTokens: 16_384,
      abortSignal: params.abortSignal,
      temperature: 0.2,
      onChunk: ({ chunk }) => {
        if (chunk.type !== "text-delta") return;
        received += chunk.text.length;
        const pct = 20 + Math.min(65, Math.round((received / estimate) * 65));
        if (pct > lastReported) {
          lastReported = pct;
          params.onProgress?.(pct);
        }
      },
    });

    const text = await result.text;
    const out = stripOuterFence(text);
    if (!out.trim()) throw new Error("Model returned an empty translation");
    params.onProgress?.(88);
    return out;
  };

  if (hasCredentialsForModel(TRANSLATE_MODEL, params.keys)) {
    try {
      return await tryModel(TRANSLATE_MODEL);
    } catch (e) {
      if (params.abortSignal?.aborted) throw e;
      /* try fallback */
    }
  }

  const fallback = params.fallbackModelId?.trim();
  if (fallback && fallback !== TRANSLATE_MODEL) {
    return await tryModel(fallback);
  }

  if (hasCredentialsForModel(TRANSLATE_MODEL, params.keys)) {
    return await tryModel(TRANSLATE_MODEL);
  }

  throw new Error(
    missingCredentialsMessage(fallback || TRANSLATE_MODEL, params.keys),
  );
}

/** Prepare body (mask tags) → LLM → restore tags; frontmatter never leaves this helper. */
export async function translateNoteMarkdown(
  content: string,
  params: Omit<TranslateNoteParams, "sourcePath">,
): Promise<string> {
  const { body } = splitFrontmatter(content);
  if (!body.trim()) {
    return joinWithOriginalFrontmatter(content, body);
  }

  const protectedBody = protectInlineTags(body);
  const translated = await translateMarkdownBody({
    body: protectedBody.text,
    targetLanguage: params.targetLanguage,
    keys: params.keys,
    fallbackModelId: params.fallbackModelId,
    abortSignal: params.abortSignal,
    onProgress: params.onProgress
      ? (progress) => params.onProgress?.(progress)
      : undefined,
  });
  const restored = protectedBody.restore(translated);
  return joinWithOriginalFrontmatter(content, restored);
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

async function prepareTranslation(
  params: TranslateNoteParams & { preferEditor?: boolean },
): Promise<{ sourcePath: string; content: string; translated: string }> {
  const sourcePath = params.sourcePath.trim();
  if (!sourcePath.toLowerCase().endsWith(".md")) {
    throw new Error("Only markdown notes can be translated");
  }

  params.onProgress?.(5, "Reading note");
  const content = await loadSourceMarkdown(
    sourcePath,
    params.preferEditor === true,
  );
  if (!content.trim()) {
    throw new Error("Note is empty");
  }
  if (content.length > MAX_SOURCE_CHARS) {
    throw new Error(
      `Note is too long to translate in one pass (${content.length.toLocaleString()} chars; max ${MAX_SOURCE_CHARS.toLocaleString()})`,
    );
  }

  const canTranslate =
    hasCredentialsForModel(TRANSLATE_MODEL, params.keys) ||
    (!!params.fallbackModelId?.trim() &&
      hasCredentialsForModel(params.fallbackModelId, params.keys));
  if (!canTranslate) {
    throw new Error(
      missingCredentialsMessage(
        params.fallbackModelId?.trim() || TRANSLATE_MODEL,
        params.keys,
      ),
    );
  }

  params.onProgress?.(15, "Translating");
  const translated = await translateNoteMarkdown(content, {
    targetLanguage: params.targetLanguage,
    keys: params.keys,
    fallbackModelId: params.fallbackModelId,
    abortSignal: params.abortSignal,
    onProgress: params.onProgress,
  });
  return { sourcePath, content, translated };
}

/**
 * Translate a markdown note in place (overwrite the same file).
 * Preserves YAML frontmatter and inline #tags. Uses editor buffer when open.
 */
export async function translateNoteInPlace(
  params: TranslateNoteParams & { preferEditor?: boolean },
): Promise<TranslateNoteResult> {
  const { sourcePath, translated } = await prepareTranslation({
    ...params,
    preferEditor: params.preferEditor !== false,
  });

  params.onProgress?.(92, "Saving note");
  const saved = await writeNote(sourcePath, translated);
  const vault = useVaultStore.getState();
  if (vault.activePath === sourcePath) {
    // Defer remount so chat/status UI can paint first (same as edit_note).
    window.setTimeout(() => {
      const latest = useVaultStore.getState();
      if (latest.activePath !== sourcePath) return;
      latest.applyExternalContent(sourcePath, saved);
      latest.markExternalWrite();
    }, 0);
  }

  params.onProgress?.(100, sourcePath);
  return { path: sourcePath, language: params.targetLanguage };
}

/**
 * Read a markdown note, translate it via LLM, and create a sibling note
 * named `Stem.XX.md` (e.g. `Meeting.RU.md`).
 */
export async function translateNoteToSibling(
  params: TranslateNoteParams,
): Promise<TranslateNoteResult> {
  const { sourcePath, translated } = await prepareTranslation({
    ...params,
    preferEditor: false,
  });

  params.onProgress?.(92, "Saving note");
  const desired = translatedSiblingPath(sourcePath, params.targetLanguage);
  const created = await createNoteUnique(desired);
  await writeNote(created, translated);

  const vault = useVaultStore.getState();
  await vault.refreshTree();
  await vault.openNote(created, { preview: false });

  params.onProgress?.(100, created);
  return { path: created, language: params.targetLanguage };
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
 * Fire-and-forget translation: progress appears in the bottom status bar.
 * Re-invoking for the same note cancels the previous run.
 */
export function startTranslateNote(sourcePath: string): void {
  const path = sourcePath.trim();
  if (!path.toLowerCase().endsWith(".md")) return;

  const jobId = translateJobId(path);
  const name = noteDisplayName(path);
  const language = usePrefsStore.getState().prefs.nativeLanguage;
  const langLabel = nativeLanguageLabel(language);
  const label = `Translating ${name}`;

  activeAbortByJob.get(jobId)?.abort();
  const ac = new AbortController();
  activeAbortByJob.set(jobId, ac);

  reportJob(jobId, {
    label,
    progress: 0,
    status: "running",
    detail: `→ ${langLabel}`,
  });

  void (async () => {
    try {
      const aiSettings = useAiSettingsStore.getState().settings;
      await translateNoteToSibling({
        sourcePath: path,
        targetLanguage: language,
        keys: credentialsFromSettings(aiSettings),
        fallbackModelId: aiSettings.modelId,
        abortSignal: ac.signal,
        onProgress: (progress, detail) => {
          if (ac.signal.aborted) return;
          reportJob(jobId, {
            label,
            progress,
            status: "running",
            detail: detail ?? `→ ${langLabel}`,
          });
        },
      });
      if (ac.signal.aborted) return;
      reportJob(jobId, {
        label: `Translated ${name}`,
        progress: 100,
        status: "done",
        detail: `→ ${langLabel}`,
      });
    } catch (err) {
      if (ac.signal.aborted) {
        useBackgroundJobsStore.getState().removeJob(jobId);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      reportJob(jobId, {
        label: `Translate ${name}`,
        progress: 0,
        status: "error",
        detail: msg || "Translation failed",
      });
    } finally {
      if (activeAbortByJob.get(jobId) === ac) {
        activeAbortByJob.delete(jobId);
      }
    }
  })();
}

/** Cancel an in-flight translation job (status bar / programmatic). */
export function cancelTranslateNote(sourcePath: string): void {
  const jobId = translateJobId(sourcePath.trim());
  activeAbortByJob.get(jobId)?.abort();
  activeAbortByJob.delete(jobId);
  clearErrorHideTimer(jobId);
  useBackgroundJobsStore.getState().removeJob(jobId);
}

/** Fire-and-forget in-place translation (sidebar menu). Progress in status bar. */
export function startTranslateNoteInPlace(sourcePath: string): void {
  void translateNoteInPlaceWithJob({ sourcePath }).catch(() => {
    /* error already shown in status bar */
  });
}

/**
 * Awaitable in-place translation with status-bar progress (for the agent tool).
 * Cancels any prior job for the same path.
 */
export async function translateNoteInPlaceWithJob(params: {
  sourcePath: string;
  targetLanguage?: NativeLanguageId;
}): Promise<TranslateNoteResult> {
  const path = params.sourcePath.trim();
  if (!path.toLowerCase().endsWith(".md")) {
    throw new Error("Only markdown notes can be translated");
  }

  const language =
    params.targetLanguage ?? usePrefsStore.getState().prefs.nativeLanguage;
  const jobId = translateJobId(path);
  const name = noteDisplayName(path);
  const langLabel = nativeLanguageLabel(language);
  const label = `Translating ${name}`;

  activeAbortByJob.get(jobId)?.abort();
  const ac = new AbortController();
  activeAbortByJob.set(jobId, ac);

  reportJob(jobId, {
    label,
    progress: 0,
    status: "running",
    detail: `→ ${langLabel} (in place)`,
  });

  try {
    const aiSettings = useAiSettingsStore.getState().settings;
    const result = await translateNoteInPlace({
      sourcePath: path,
      targetLanguage: language,
      keys: credentialsFromSettings(aiSettings),
      fallbackModelId: aiSettings.modelId,
      abortSignal: ac.signal,
      preferEditor: true,
      onProgress: (progress, detail) => {
        if (ac.signal.aborted) return;
        reportJob(jobId, {
          label,
          progress,
          status: "running",
          detail: detail ?? `→ ${langLabel} (in place)`,
        });
      },
    });
    if (ac.signal.aborted) {
      useBackgroundJobsStore.getState().removeJob(jobId);
      throw new Error("Translation cancelled");
    }
    reportJob(jobId, {
      label: `Translated ${name}`,
      progress: 100,
      status: "done",
      detail: `→ ${langLabel} (in place)`,
    });
    return result;
  } catch (err) {
    if (ac.signal.aborted) {
      useBackgroundJobsStore.getState().removeJob(jobId);
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    reportJob(jobId, {
      label: `Translate ${name}`,
      progress: 0,
      status: "error",
      detail: msg || "Translation failed",
    });
    throw err;
  } finally {
    if (activeAbortByJob.get(jobId) === ac) {
      activeAbortByJob.delete(jobId);
    }
  }
}

export const _test = {
  translatedSiblingPath,
  stripOuterFence,
  noteStem,
  protectInlineTags,
  joinWithOriginalFrontmatter,
  translateJobId,
};
