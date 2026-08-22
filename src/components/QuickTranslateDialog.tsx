import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { credentialsFromSettings } from "../ai/languageModel";
import {
  collectLearningLanguageCodes,
  DEFAULT_FOREIGN_LANG,
  dictItemFromQuickTranslate,
  formatQuickTranslateMarkdown,
  quickTranslate,
  quickTranslatePairCodes,
  quickTranslatePairLabel,
  quickTranslateShowForms,
  quickTranslateTargetHead,
  type QuickTranslateResult,
} from "../ai/quickTranslate";
import {
  canInsertTextInActiveMarkdown,
  focusActiveMarkdownEditor,
  insertTextInActiveMarkdown,
} from "../editor/completedTasksCommand";
import {
  collectVaultMddictPaths,
  filterMddictPathsForLearningLanguage,
  sortMddictPathsForPicker,
} from "../editor/mddict/dictPractice";
import { appendOrMergeDictEntry } from "../lib/mddictWrite";
import { isNativeLanguageId, nativeLanguageLabel } from "../settings/types";
import { useAiSettingsStore } from "../store/aiSettingsStore";
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

export function QuickTranslateDialog({
  open,
  initialQuery = "",
  onClose,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const insertBtnRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const selectQueryRef = useRef(false);
  const wasOpenRef = useRef(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickTranslateResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
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
  const canInsert = useVaultStore((s) => {
    void s.activePath;
    void s.viewMode;
    return canInsertTextInActiveMarkdown();
  });

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
    try {
      const next = await quickTranslate({
        query: trimmed,
        foreignLanguageCode: foreignLang,
        foreignLanguageLabel: foreignLabel,
        nativeLanguageCode: nativeLanguage,
        nativeLanguageLabel: nativeLabel,
        keys: credentialsFromSettings(aiSettings),
        ...helperModelCallParams(),
        abortSignal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setResult(next);
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

  const insert = () => {
    if (!result || busy) return;
    const ok = insertTextInActiveMarkdown(
      formatQuickTranslateMarkdown(result, nativeLanguage),
    );
    if (!ok) {
      setError("Open a markdown note to insert at the cursor.");
      return;
    }
    close();
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
        description={
          result
            ? undefined
            : `A ${foreignLabel} or ${nativeLabel} word. Press Enter.`
        }
        className={[
          "quick-translate-dialog",
          result ? "is-expanded" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onCancel={() => {
          if (pickerOpen) return;
          if (busy) {
            abortRef.current?.abort();
            return;
          }
          close();
        }}
        footer={
          <>
            <button type="button" className="app-dialog-btn" tabIndex={-1} onClick={close}>
              Cancel
            </button>
            <div className="app-dialog-footer-spacer" />
            <button
              ref={insertBtnRef}
              type="button"
              className="app-dialog-btn is-primary"
              disabled={!result || busy || !canInsert}
              title={
                canInsert
                  ? undefined
                  : "Open a markdown note to insert at the cursor"
              }
              onClick={insert}
            >
              Insert
            </button>
            <button
              type="button"
              className="app-dialog-btn"
              disabled={!result || busy}
              onClick={openPicker}
            >
              Add to dictionary
            </button>
          </>
        }
      >
        <div className="app-dialog-body quick-translate-body">
          <div className="quick-translate-search">
            {showPairPicker ? (
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
                }}
              />
            ) : null}
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
                    const target = canInsert ? insertBtnRef.current : null;
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

          {busy && !result ? (
            <p className="quick-translate-status">Looking up…</p>
          ) : null}

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
          {status ? (
            <p className="quick-translate-status" role="status">
              {status}
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
            : "The word card stays open. Nothing is inserted into the note."
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
