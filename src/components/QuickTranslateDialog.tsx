import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { credentialsFromSettings } from "../ai/languageModel";
import { startLexiconArticleJob } from "../ai/lexiconArticle";
import {
  collectLearningLanguageCodes,
  DEFAULT_FOREIGN_LANG,
  dictItemFromQuickTranslate,
  quickTranslate,
  quickTranslatePairCodes,
  quickTranslatePairLabel,
  quickTranslateShowForms,
  quickTranslateTargetHead,
  type QuickTranslateResult,
} from "../ai/quickTranslate";
import { focusActiveMarkdownEditor } from "../editor/completedTasksCommand";
import {
  collectVaultMddictPaths,
  filterMddictPathsForLearningLanguage,
  sortMddictPathsForPicker,
} from "../editor/mddict/dictPractice";
import {
  isLexiconWorthyQuery,
  loadLexiconHits,
  lookupLexiconHit,
  pickLexiconProject,
  upsertLexiconNote,
} from "../lib/lexiconNotes";
import {
  collectFolderAbouts,
} from "../lib/folderContext";
import { appendOrMergeDictEntry } from "../lib/mddictWrite";
import {
  loadQuickTranslateCache,
  lookupCachedTranslation,
  saveQuickTranslateCache,
  upsertCachedTranslation,
} from "../lib/quickTranslateCache";
import { isNativeLanguageId, nativeLanguageLabel } from "../settings/types";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { useShallow } from "zustand/react/shallow";
import { useBackgroundJobsStore } from "../store/backgroundJobsStore";
import { helperModelCallParams } from "../store/vaultAiSettingsStore";
import { usePrefsStore } from "../store/prefsStore";
import { useVaultStore } from "../store/vaultStore";
import { DialogShell } from "./AppDialog";
import { Select } from "./ui/Select";

const LAST_DICT_KEY = "markspace.quick-translate.last-dict";
const LAST_PAIR_KEY = "markspace.quick-translate.foreign-lang";
const QUERY_MAX = 200;

type Props = {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
};

function readLastDictPath(): string {
  try {
    return localStorage.getItem(LAST_DICT_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeLastDictPath(path: string) {
  try {
    localStorage.setItem(LAST_DICT_KEY, path);
  } catch {
    /* ignore quota / private mode */
  }
}

function readLastForeignLang(): string {
  try {
    return localStorage.getItem(LAST_PAIR_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeLastForeignLang(code: string) {
  try {
    localStorage.setItem(LAST_PAIR_KEY, code);
  } catch {
    /* ignore quota / private mode */
  }
}

function dictLabel(path: string): string {
  const i = path.lastIndexOf("/");
  if (i < 0) return path;
  return `${path.slice(i + 1)} — ${path.slice(0, i)}`;
}

function focusVisible(el: HTMLElement | null) {
  if (!el) return;
  try {
    el.focus({
      preventScroll: true,
      focusVisible: true,
    } as FocusOptions);
  } catch {
    el.focus({ preventScroll: true });
  }
}

function stubResultFromLemma(
  query: string,
  lemma: string,
  foreignLang: string,
): QuickTranslateResult {
  return {
    query,
    queryLang: foreignLang,
    lemma,
    transcript: "",
    translation: lemma,
    translationTranscript: "",
    didYouMean: "",
    forms: [],
    synonyms: [],
    senses: [],
    examples: [],
  };
}

export function QuickTranslateDialog({
  open,
  initialQuery = "",
  onClose,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const addDictBtnRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const selectQueryRef = useRef(false);
  const wasOpenRef = useRef(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickTranslateResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lexiconPath, setLexiconPath] = useState<string | null>(null);
  const [lexiconNoteReady, setLexiconNoteReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPath, setPickerPath] = useState("");
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [foreignLang, setForeignLang] = useState(DEFAULT_FOREIGN_LANG);

  const aiSettings = useAiSettingsStore((s) => s.settings);
  const nativeLanguage = usePrefsStore((s) => s.prefs.nativeLanguage);
  const tree = useVaultStore((s) => s.tree);
  const activePath = useVaultStore((s) => s.activePath);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const openNote = useVaultStore((s) => s.openNote);
  // Only the fields the footer shows: `progress` ticks several times a second
  // and would otherwise re-render the whole dialog for nothing.
  const lexiconJobRecord = useBackgroundJobsStore(
    useShallow((s) => {
      const job = lexiconPath
        ? s.jobs[`lexicon-article:${lexiconPath}`]
        : undefined;
      if (!job) return null;
      return { status: job.status, label: job.label, detail: job.detail };
    }),
  );
  const lexiconJob =
    lexiconJobRecord &&
    (lexiconJobRecord.status === "running" ||
      lexiconJobRecord.status === "error")
      ? lexiconJobRecord
      : null;

  useEffect(() => {
    if (lexiconJobRecord?.status === "done") setLexiconNoteReady(true);
  }, [lexiconJobRecord]);
  const footerStatus =
    busy && !result
      ? "Translating…"
      : lexiconJob
        ? lexiconJob.detail || lexiconJob.label
        : status;

  const showFooter = Boolean(result || footerStatus || lexiconPath);

  const dictPaths = useMemo(
    () =>
      filterMddictPathsForLearningLanguage(
        sortMddictPathsForPicker(collectVaultMddictPaths(tree), activePath),
        projectPropertiesByPath,
        foreignLang,
      ),
    [tree, activePath, projectPropertiesByPath, foreignLang],
  );
  const dictOptions = useMemo(
    () => dictPaths.map((path) => ({ value: path, label: dictLabel(path) })),
    [dictPaths],
  );
  const pairCodes = useMemo(
    () =>
      quickTranslatePairCodes(
        collectLearningLanguageCodes(
          projectPropertiesByPath,
          nativeLanguage,
        ),
        nativeLanguage,
      ),
    [projectPropertiesByPath, nativeLanguage],
  );
  const showPairPicker = pairCodes.length > 1;
  const pairOptions = useMemo(
    () =>
      pairCodes.map((code) => ({
        value: code,
        label: quickTranslatePairLabel(code, nativeLanguage),
      })),
    [pairCodes, nativeLanguage],
  );
  const foreignLabel = isNativeLanguageId(foreignLang)
    ? nativeLanguageLabel(foreignLang)
    : foreignLang;
  const nativeLabel = nativeLanguageLabel(nativeLanguage);
  const targetHead = result ? quickTranslateTargetHead(result) : null;

  useEffect(() => {
    if (!open) return;
    const last = readLastForeignLang();
    const next = pairCodes.includes(last)
      ? last
      : pairCodes.includes(DEFAULT_FOREIGN_LANG)
        ? DEFAULT_FOREIGN_LANG
        : (pairCodes[0] ?? DEFAULT_FOREIGN_LANG);
    setForeignLang(next);
  }, [open, pairCodes]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      setPickerOpen(false);
      setPickerBusy(false);
      return;
    }
    const next = initialQuery.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
    setQuery(next);
    setError(null);
    setResult(null);
    setStatus(null);
    setLexiconPath(null);
    setLexiconNoteReady(false);
    setPickerOpen(false);
    setPickerError(null);
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, initialQuery]);

  useLayoutEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    focusActiveMarkdownEditor();
  }, [open]);

  useLayoutEffect(() => {
    if (!open || busy || !selectQueryRef.current) return;
    selectQueryRef.current = false;
    const el = inputRef.current;
    if (!el || el.disabled) return;
    el.focus();
    el.select();
  }, [open, busy, result, error]);

  const lookup = async (rawQuery = query) => {
    const trimmed = rawQuery.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
    if (!trimmed || busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    setStatus(null);
    setLexiconPath(null);
    setLexiconNoteReady(false);
    const project = pickLexiconProject(
      projectPropertiesByPath,
      foreignLang,
      activePath,
    );
    const modelParams = helperModelCallParams();
    const keys = credentialsFromSettings(aiSettings);

    const attachNote = (path: string | undefined) => {
      if (!path) return;
      setLexiconPath(path);
      setLexiconNoteReady(true);
    };

    try {
      let cache = await loadQuickTranslateCache();
      if (ac.signal.aborted) return;
      const cached = lookupCachedTranslation(
        cache,
        foreignLang,
        nativeLanguage,
        trimmed,
      );
      if (cached) {
        setResult(cached.result);
        if (cached.notePath) {
          attachNote(cached.notePath);
        } else if (project) {
          const { hits, surfacesByPath } = await loadLexiconHits(tree, project);
          const hit = lookupLexiconHit(hits, trimmed, surfacesByPath);
          if (hit) {
            setLexiconPath(hit.path);
            setLexiconNoteReady(true);
          }
        }
        return;
      }

      if (project) {
        const { hits, surfacesByPath } = await loadLexiconHits(tree, project);
        if (ac.signal.aborted) return;
        const hit = lookupLexiconHit(hits, trimmed, surfacesByPath);
        if (hit) {
          const byLemma = lookupCachedTranslation(
            cache,
            foreignLang,
            nativeLanguage,
            hit.lemma,
          );
          setResult(
            byLemma?.result ??
              stubResultFromLemma(trimmed, hit.lemma, foreignLang),
          );
          setLexiconPath(hit.path);
          setLexiconNoteReady(true);
          return;
        }
      }

      setStatus("Translating…");
      const next = await quickTranslate({
        query: trimmed,
        foreignLanguageCode: foreignLang,
        foreignLanguageLabel: foreignLabel,
        nativeLanguageCode: nativeLanguage,
        nativeLanguageLabel: nativeLabel,
        keys,
        ...modelParams,
        abortSignal: ac.signal,
        folderContext: collectFolderAbouts(
          [activePath],
          projectPropertiesByPath,
        ),
      });
      if (ac.signal.aborted) return;
      setResult(next);
      setStatus(null);
      cache = upsertCachedTranslation(
        cache,
        foreignLang,
        nativeLanguage,
        next,
      );
      await saveQuickTranslateCache(cache);

      if (project && isLexiconWorthyQuery(trimmed)) {
        const saved = await upsertLexiconNote({
          projectPath: project,
          result: next,
          foreignLanguageCode: foreignLang,
          nativeLanguageCode: nativeLanguage,
        });
        cache = upsertCachedTranslation(
          cache,
          foreignLang,
          nativeLanguage,
          next,
          saved.path,
        );
        await saveQuickTranslateCache(cache);
        setLexiconPath(saved.path);
        startLexiconArticleJob({
          notePath: saved.path,
          projectPath: project,
          result: next,
          foreignLanguageCode: foreignLang,
          foreignLanguageLabel: foreignLabel,
          nativeLanguageCode: nativeLanguage,
          nativeLanguageLabel: nativeLabel,
        });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        selectQueryRef.current = true;
        setBusy(false);
      }
    }
  };

  const close = () => {
    abortRef.current?.abort();
    setPickerOpen(false);
    onClose();
  };

  const openPicker = () => {
    if (!result || busy) return;
    const last = readLastDictPath();
    setPickerPath(
      dictPaths.includes(last) ? last : (dictPaths[0] ?? ""),
    );
    setPickerError(null);
    setPickerOpen(true);
  };

  const lookupSynonym = (word: string) => {
    const next = word.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
    if (!next || busy) return;
    setQuery(next);
    setResult(null);
    void lookup(next);
  };

  const addToDictionary = async () => {
    if (!result || pickerBusy) return;
    const path = pickerPath.trim();
    if (!path) {
      setPickerError("Choose a dictionary.");
      return;
    }
    setPickerBusy(true);
    setPickerError(null);
    try {
      const item = dictItemFromQuickTranslate(
        result,
        nativeLanguage,
        foreignLang,
      );
      const saved = await appendOrMergeDictEntry(path, item);
      writeLastDictPath(saved.path);
      setStatus(
        saved.merged
          ? `Updated ${saved.path}`
          : `Added to ${saved.path}`,
      );
      setPickerOpen(false);
    } catch (e) {
      setPickerError(e instanceof Error ? e.message : String(e));
    } finally {
      setPickerBusy(false);
    }
  };

  return (
    <>
      <DialogShell
        open={open}
        title="Translate"
        hideTitle
        showClose
        headerLeading={
          showPairPicker ? (
            <Select
              variant="field"
              menuPlacement="below"
              tabIndex={-1}
              aria-label="Language pair"
              value={foreignLang}
              options={pairOptions}
              disabled={busy}
              onChange={(code) => {
                writeLastForeignLang(code);
                setForeignLang(code);
                setResult(null);
                setStatus(null);
                setLexiconPath(null);
                setLexiconNoteReady(false);
              }}
            />
          ) : null
        }
        className={[
          "quick-translate-dialog",
          result ? "is-expanded" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onCancel={() => {
          if (pickerOpen) return;
          abortRef.current?.abort();
          close();
        }}
        footer={
          showFooter ? (
          <>
            <div className="quick-translate-footer-meta">
              {lexiconPath && lexiconNoteReady ? (
                <button
                  type="button"
                  className="quick-translate-note-link"
                  onClick={() => {
                    const path = lexiconPath;
                    close();
                    void openNote(path, { preview: false });
                  }}
                >
                  Open note
                </button>
              ) : null}
              {footerStatus ? (
                <p className="quick-translate-status" role="status">
                  {footerStatus}
                </p>
              ) : null}
            </div>
            <button
              ref={addDictBtnRef}
              type="button"
              className="app-dialog-btn"
              disabled={!result || busy}
              onClick={openPicker}
            >
              Add to dictionary
            </button>
          </>
          ) : undefined
        }
      >
        <div className="app-dialog-body quick-translate-body">
          <div className="quick-translate-search">
            <div className="quick-translate-input-row">
              <input
                ref={inputRef}
                id={inputId}
                className="quick-translate-query"
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, QUERY_MAX))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void lookup();
                    return;
                  }
                  if (e.key === "Tab" && !e.shiftKey && result && !busy) {
                    const target = addDictBtnRef.current;
                    if (target && !target.disabled) {
                      e.preventDefault();
                      focusVisible(target);
                    }
                  }
                }}
                placeholder={`${foreignLabel} or ${nativeLabel}`}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
              />
              <button
                type="button"
                className="quick-translate-go"
                tabIndex={-1}
                disabled={!query.trim() || busy}
                onClick={() => void lookup()}
              >
                {busy ? "…" : "Look up"}
              </button>
            </div>
          </div>

          {result && targetHead ? (
            <div className="quick-translate-card" aria-live="polite">
              <header className="quick-translate-head">
                {result.didYouMean ? (
                  <p className="quick-translate-didyoumean">
                    Did you mean{" "}
                    <button
                      type="button"
                      className="quick-translate-didyoumean-btn"
                      disabled={busy}
                      onClick={() => lookupSynonym(result.didYouMean)}
                    >
                      {result.didYouMean}
                    </button>
                    ?
                  </p>
                ) : null}
                <p className="quick-translate-lemma">{targetHead.word}</p>
                {targetHead.transcript &&
                quickTranslateShowForms(result, nativeLanguage) ? (
                  <p className="quick-translate-transcript">
                    {targetHead.transcript}
                  </p>
                ) : null}
              </header>
              {result.senses.length > 0 ? (
                <div className="quick-translate-section">
                  <div className="quick-translate-section-label">Meanings</div>
                  <ul className="quick-translate-senses">
                    {result.senses.map((sense, i) => (
                      <li
                        key={`${sense.pos}-${sense.meaning}-${i}`}
                        className="quick-translate-sense"
                      >
                        <div className="quick-translate-sense-meta">
                          {sense.pos ? (
                            <span className="quick-translate-pos">{sense.pos}</span>
                          ) : null}
                          {sense.register ? (
                            <span className="quick-translate-register">
                              {sense.register}
                            </span>
                          ) : null}
                        </div>
                        {sense.meaning ? (
                          <p className="quick-translate-sense-meaning">
                            {sense.meaning}
                          </p>
                        ) : null}
                        {sense.usage ? (
                          <p className="quick-translate-sense-usage">
                            {sense.usage}
                          </p>
                        ) : null}
                        {sense.collocations.length > 0 ? (
                          <p
                            className="quick-translate-collocations"
                            aria-label="Collocations"
                          >
                            {sense.collocations.map((chunk, i) => (
                              <span key={chunk}>
                                {i > 0 ? ", " : null}
                                <button
                                  type="button"
                                  className="quick-translate-synonym"
                                  disabled={busy}
                                  title={`Look up ${chunk}`}
                                  onClick={() => lookupSynonym(chunk)}
                                >
                                  {chunk}
                                </button>
                              </span>
                            ))}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result.synonyms.length > 0 ? (
                <div className="quick-translate-section">
                  <div className="quick-translate-section-label">Synonyms</div>
                  <p className="quick-translate-synonyms" aria-label="Synonyms">
                    {result.synonyms.map((word, i) => (
                      <span key={word}>
                        {i > 0 ? ", " : null}
                        <button
                          type="button"
                          className="quick-translate-synonym"
                          disabled={busy}
                          title={`Look up ${word}`}
                          onClick={() => lookupSynonym(word)}
                        >
                          {word}
                        </button>
                      </span>
                    ))}
                  </p>
                </div>
              ) : null}
              {result.forms.length > 0 &&
              quickTranslateShowForms(result, nativeLanguage) ? (
                <div className="quick-translate-section">
                  <div className="quick-translate-section-label">Forms</div>
                  <ul className="quick-translate-forms">
                    {result.forms.map((form) => (
                      <li key={form} className="quick-translate-form">
                        {form}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result.examples.length > 0 ? (
                <div className="quick-translate-section">
                  <div className="quick-translate-section-label">Examples</div>
                  <ul className="quick-translate-examples">
                    {result.examples.map((ex) => (
                      <li key={ex.text}>
                        <p className="quick-translate-example-text">{ex.text}</p>
                        {ex.translation ? (
                          <p className="quick-translate-example-tr">
                            {ex.translation}
                          </p>
                        ) : null}
                        {ex.note ? (
                          <p className="quick-translate-example-note">{ex.note}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="link-dialog-suggest-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </DialogShell>

      <DialogShell
        open={open && pickerOpen}
        nested
        title="Add to dictionary"
        description={
          dictPaths.length === 0
            ? "No dictionaries in this vault. Create one with New dictionary."
            : "The word card stays open. The lexicon note is not changed."
        }
        onCancel={() => {
          if (pickerBusy) return;
          setPickerOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="app-dialog-btn"
              disabled={pickerBusy}
              onClick={() => setPickerOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="app-dialog-btn is-primary"
              disabled={pickerBusy || dictPaths.length === 0 || !pickerPath}
              onClick={() => void addToDictionary()}
            >
              {pickerBusy ? "Adding…" : "Add"}
            </button>
          </>
        }
      >
        {dictPaths.length > 0 ? (
          <div className="app-dialog-body">
            <label className="app-dialog-label" id="quick-translate-dict-label">
              Dictionary
            </label>
            <Select
              variant="field"
              menuPlacement="below"
              aria-label="Dictionary"
              value={pickerPath}
              options={dictOptions}
              onChange={setPickerPath}
              disabled={pickerBusy}
            />
            {pickerError ? (
              <p className="link-dialog-suggest-error" role="alert">
                {pickerError}
              </p>
            ) : null}
          </div>
        ) : pickerError ? (
          <div className="app-dialog-body">
            <p className="link-dialog-suggest-error" role="alert">
              {pickerError}
            </p>
          </div>
        ) : undefined}
      </DialogShell>
    </>
  );
}
