import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdAutoAwesome } from "react-icons/md";
import {
  applyGapFill,
  entryNeedsGapFill,
  fillDictGaps,
} from "../../ai/fillDictGaps";
import { credentialsFromSettings } from "../../ai/languageModel";
import {
  AddWordDialog,
  type AddWordDialogValue,
} from "../../components/AppDialog";
import { DocumentToolbar } from "../../components/DocumentToolbar";
import { TagChipsInput } from "../../components/TagChipsInput";
import {
  DICT_KNOWN_THRESHOLD,
  getDictProgress,
  setDictEntryCorrectCount,
} from "../../lib/dictProgress";
import {
  MDDICT_HEADER,
  collectMddictTags,
  parseMddict,
  serializeMddict,
  type MddictDoc,
} from "../../lib/mddictFormat";
import {
  isNativeLanguageId,
  nativeLanguageLabel,
} from "../../settings/types";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { helperModelCallParams } from "../../store/vaultAiSettingsStore";
import { usePrefsStore } from "../../store/prefsStore";
import { useVaultStore } from "../../store/vaultStore";
import { DictAiFillDialog } from "./DictAiFillDialog";
import { DictGrid } from "./DictGrid";
import {
  ensureRows,
  itemsToRows,
  newRowKey,
  rowsToItems,
  withTrailingBlank,
  type GridRow,
} from "./dictGridTypes";

type Props = {
  path: string;
  content: string;
  onChange: (next: string) => void;
};

type DictRevealMode = "all" | "translation" | "word";

const REVEAL_MODES: { mode: DictRevealMode; label: string; title: string }[] = [
  { mode: "all", label: "All", title: "Show all columns" },
  {
    mode: "translation",
    label: "Translation",
    title: "Show translation only — recall the word",
  },
  {
    mode: "word",
    label: "Word",
    title: "Show word only — recall the translation",
  },
];

function safeParse(content: string): { doc: MddictDoc; error: string | null } {
  try {
    return { doc: parseMddict(content), error: null };
  } catch (e) {
    return {
      doc: { filter: [], items: [] },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function rowMatchesQuery(row: GridRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.word.toLowerCase().includes(q)) return true;
  if (row.transcript.toLowerCase().includes(q)) return true;
  if (row.translation.toLowerCase().includes(q)) return true;
  if (row.examples.toLowerCase().includes(q)) return true;
  return row.tags.some((t) => t.toLowerCase().includes(q));
}

function rowMatchesFilter(row: GridRow, filter: string[]): boolean {
  if (filter.length === 0) return true;
  const need = filter.map((t) => t.toLowerCase());
  const have = new Set(row.tags.map((t) => t.toLowerCase()));
  return need.every((t) => have.has(t));
}

function rowToGapFields(row: GridRow) {
  return {
    word: row.word,
    transcript: row.transcript,
    translation: row.translation,
    examples: row.examples
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

export function DictionaryEditor({ path, content, onChange }: Props) {
  const { doc, error } = useMemo(() => safeParse(content), [content]);
  const dictionaryTags = useVaultStore((s) => s.dictionaryTags);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const aiSettings = useAiSettingsStore((s) => s.settings);
  const nativeLanguage = usePrefsStore((s) => s.prefs.nativeLanguage);
  const [searchQuery, setSearchQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [aiFillOpen, setAiFillOpen] = useState(false);
  const [aiFillDone, setAiFillDone] = useState(0);
  const [aiFillTotal, setAiFillTotal] = useState(0);
  const [aiFillError, setAiFillError] = useState<string | null>(null);
  const aiFillAbortRef = useRef<AbortController | null>(null);
  const [revealMode, setRevealMode] = useState<DictRevealMode>("all");
  const [rows, setRows] = useState<GridRow[]>(() =>
    ensureRows(itemsToRows(doc.items)),
  );
  const [correctCountByWord, setCorrectCountByWord] = useState<
    Record<string, number>
  >({});
  const lastEmitted = useRef(content);

  const projectPath = path.split("/")[0] ?? "";
  const projectProps = projectPropertiesByPath[projectPath];
  const isLanguageLearning = projectProps?.projectType === "languageLearning";
  const learningLanguageCode = isLanguageLearning
    ? (projectProps.learningLanguage ?? "").trim()
    : "";
  const learningLanguageLabel = learningLanguageCode
    ? isNativeLanguageId(learningLanguageCode)
      ? nativeLanguageLabel(learningLanguageCode)
      : learningLanguageCode
    : "";

  const gapCount = useMemo(
    () => rows.filter((r) => entryNeedsGapFill(rowToGapFields(r))).length,
    [rows],
  );

  const reloadProgress = useCallback(async () => {
    if (!projectPath) {
      setCorrectCountByWord({});
      return;
    }
    try {
      const prog = await getDictProgress(projectPath);
      const byDict = prog.entries[path] ?? {};
      const map: Record<string, number> = {};
      for (const [word, entry] of Object.entries(byDict)) {
        map[word.trim().toLowerCase()] = entry.correctCount ?? 0;
      }
      setCorrectCountByWord(map);
    } catch {
      setCorrectCountByWord({});
    }
  }, [path, projectPath]);

  useEffect(() => {
    void reloadProgress();
  }, [reloadProgress]);

  useEffect(() => {
    if (content === lastEmitted.current) return;
    lastEmitted.current = content;
    const parsed = safeParse(content);
    if (parsed.error) return;
    setRows(ensureRows(itemsToRows(parsed.doc.items)));
  }, [content]);

  useEffect(() => {
    return () => {
      aiFillAbortRef.current?.abort();
    };
  }, []);

  const fileTags = useMemo(() => collectMddictTags(rowsToItems(rows)), [rows]);

  const emitDoc = useCallback(
    (nextDoc: MddictDoc, nextRows: GridRow[]) => {
      setRows(ensureRows(nextRows));
      const text = serializeMddict(nextDoc);
      lastEmitted.current = text;
      onChange(text);
    },
    [onChange],
  );

  const setFilter = (tags: string[]) => {
    emitDoc({ ...doc, filter: tags, items: rowsToItems(rows) }, rows);
  };

  const filtering =
    doc.filter.length > 0 || searchQuery.trim().length > 0;

  const visibleRows = useMemo(() => {
    return rows.filter(
      (row) =>
        rowMatchesFilter(row, doc.filter) && rowMatchesQuery(row, searchQuery),
    );
  }, [rows, doc.filter, searchQuery]);

  const onGridChange = (nextVisible: GridRow[]) => {
    if (!filtering) {
      const next = ensureRows(nextVisible);
      emitDoc({ ...doc, items: rowsToItems(next) }, next);
      return;
    }

    const visibleKeySet = new Set(visibleRows.map((r) => r.key));
    const nextMap = new Map(nextVisible.map((r) => [r.key, r]));
    let nextRows = rows
      .filter((r) => !visibleKeySet.has(r.key) || nextMap.has(r.key))
      .map((r) => nextMap.get(r.key) ?? r);
    for (const row of nextVisible) {
      if (!nextRows.some((r) => r.key === row.key)) {
        nextRows = [...nextRows, row];
      }
    }
    emitDoc({ ...doc, items: rowsToItems(nextRows) }, ensureRows(nextRows));
  };

  const onSetKnown = useCallback(
    async (row: GridRow, known: boolean) => {
      const word = row.word.trim();
      if (!word || !projectPath) return;
      const nextRows = rows.map((r) =>
        r.key === row.key ? { ...r, known } : r,
      );
      emitDoc({ ...doc, items: rowsToItems(nextRows) }, nextRows);
      await setDictEntryCorrectCount(
        projectPath,
        path,
        word,
        known ? DICT_KNOWN_THRESHOLD : 0,
      );
      await reloadProgress();
    },
    [doc, emitDoc, path, projectPath, reloadProgress, rows],
  );

  const gridRows = filtering
    ? visibleRows
    : withTrailingBlank(rows);

  const onAddWord = (value: AddWordDialogValue) => {
    const wordKey = value.word.trim().toLowerCase();
    const existingIdx = rows.findIndex(
      (r) => r.word.trim().toLowerCase() === wordKey,
    );
    const nextRow: GridRow = {
      key: existingIdx >= 0 ? rows[existingIdx]!.key : newRowKey(),
      word: value.word.trim(),
      transcript: value.transcript,
      translation: value.translation,
      examples: value.examples.join("\n"),
      tags: existingIdx >= 0 ? rows[existingIdx]!.tags : [],
      known: existingIdx >= 0 ? rows[existingIdx]!.known : false,
    };
    const nextRows =
      existingIdx >= 0
        ? rows.map((r, i) => (i === existingIdx ? nextRow : r))
        : [...rows, nextRow];
    emitDoc({ ...doc, items: rowsToItems(nextRows) }, nextRows);
    setAddOpen(false);
  };

  const closeAiFill = useCallback(() => {
    aiFillAbortRef.current?.abort();
    aiFillAbortRef.current = null;
    setAiFillOpen(false);
    setAiFillError(null);
    setAiFillDone(0);
    setAiFillTotal(0);
  }, []);

  const applyFilledEntries = useCallback(
    (filled: ReturnType<typeof rowToGapFields>[]) => {
      if (filled.length === 0) return;
      const byWord = new Map(
        filled.map((e) => [e.word.trim().toLowerCase(), e] as const),
      );
      setRows((prev) => {
        const nextRows = prev.map((row) => {
          const fill = byWord.get(row.word.trim().toLowerCase());
          if (!fill) return row;
          const merged = applyGapFill(rowToGapFields(row), fill);
          return {
            ...row,
            transcript: merged.transcript,
            translation: merged.translation,
            examples: merged.examples.join("\n"),
          };
        });
        const text = serializeMddict({
          ...doc,
          items: rowsToItems(nextRows),
        });
        lastEmitted.current = text;
        onChange(text);
        return ensureRows(nextRows);
      });
    },
    [doc, onChange],
  );

  const runAiFill = useCallback(async () => {
    const incomplete = rows.filter((r) => entryNeedsGapFill(rowToGapFields(r)));
    if (incomplete.length === 0) return;

    aiFillAbortRef.current?.abort();
    const ac = new AbortController();
    aiFillAbortRef.current = ac;
    setAiFillOpen(true);
    setAiFillError(null);
    setAiFillDone(0);
    setAiFillTotal(incomplete.length);

    try {
      await fillDictGaps({
        entries: incomplete.map(rowToGapFields),
        learningLanguageCode,
        learningLanguageLabel,
        nativeLanguageCode: nativeLanguage,
        nativeLanguageLabel: nativeLanguageLabel(nativeLanguage),
        keys: credentialsFromSettings(aiSettings),
        ...helperModelCallParams(),
        abortSignal: ac.signal,
        onProgress: (done, total) => {
          setAiFillDone(done);
          setAiFillTotal(total);
        },
        onChunk: (chunk) => {
          applyFilledEntries(chunk);
        },
      });
      if (ac.signal.aborted) return;
      closeAiFill();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        closeAiFill();
        return;
      }
      setAiFillError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aiFillAbortRef.current === ac) {
        aiFillAbortRef.current = null;
      }
    }
  }, [
    aiSettings,
    applyFilledEntries,
    closeAiFill,
    learningLanguageCode,
    learningLanguageLabel,
    nativeLanguage,
    rows,
  ]);

  if (error) {
    return (
      <div className="dict-editor-column">
        <DocumentToolbar showOutlineToggle={false} showCommentsToggle={false} />
        <div className="dict-editor">
          <div className="dict-editor-error">
            <h2>Invalid dictionary file</h2>
            <p>{error}</p>
            <p className="dict-editor-error-hint">
              Switch to Source to fix the file, or recreate it. Expected header:{" "}
              <code>{MDDICT_HEADER}</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dict-editor-column">
      <DocumentToolbar showOutlineToggle={false} showCommentsToggle={false} />
      <div className="dict-editor">
        <div className="dict-editor-toolbar">
          <div className="dict-editor-filter">
            <span className="dict-editor-filter-label">Filter</span>
            <TagChipsInput
              tags={doc.filter}
              onChange={setFilter}
              catalog={dictionaryTags}
              extraCatalog={fileTags}
              placeholder="Filter by tag…"
              ariaLabel="Filter tags"
              chipClassName="is-filter-active"
              className="dict-editor-filter-chips"
              portalPopover
            />
          </div>
          <div className="dict-editor-search">
            <label className="dict-editor-filter-label" htmlFor="dict-search">
              Search
            </label>
            <input
              id="dict-search"
              type="search"
              className="dict-editor-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Find in dictionary…"
              aria-label="Search dictionary"
            />
          </div>
          <div className="dict-editor-toolbar-actions">
            <div
              className="dict-reveal-switch"
              role="radiogroup"
              aria-label="Dictionary reveal mode"
            >
              {REVEAL_MODES.map(({ mode, label, title }) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={revealMode === mode}
                  title={title}
                  className={
                    revealMode === mode
                      ? "dict-reveal-switch-segment is-active"
                      : "dict-reveal-switch-segment"
                  }
                  onClick={() => setRevealMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="dict-editor-icon-btn"
              disabled={gapCount === 0 || aiFillOpen}
              title={
                gapCount === 0
                  ? "No empty fields to fill"
                  : `Fill empty fields with AI (${gapCount})`
              }
              aria-label="Fill empty fields with AI"
              onClick={() => {
                void runAiFill();
              }}
            >
              <MdAutoAwesome aria-hidden="true" />
            </button>
            <button
              type="button"
              className="dict-editor-add-btn"
              onClick={() => setAddOpen(true)}
            >
              Add entry
            </button>
          </div>
        </div>

        <AddWordDialog
          open={addOpen}
          learningLanguageCode={learningLanguageCode}
          learningLanguageLabel={learningLanguageLabel}
          onCancel={() => setAddOpen(false)}
          onConfirm={onAddWord}
        />

        <DictAiFillDialog
          open={aiFillOpen}
          done={aiFillDone}
          total={aiFillTotal}
          error={aiFillError}
          onCancel={closeAiFill}
        />

        {filtering && visibleRows.length === 0 ? (
          <div className="dict-editor-empty">
            <h2>No matches</h2>
            <p>
              {searchQuery.trim()
                ? "No entries match the current search and filters."
                : "No entries have all of the selected filter tags."}
            </p>
            <button
              type="button"
              className="app-dialog-btn"
              onClick={() => {
                setFilter([]);
                setSearchQuery("");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="dict-editor-sheet" data-dict-reveal={revealMode}>
            <DictGrid
              key={path}
              rows={gridRows}
              onChange={onGridChange}
              lockRows={filtering}
              autoAddRow={!filtering}
              tagCatalog={dictionaryTags}
              tagExtraCatalog={fileTags}
              correctCountByWord={correctCountByWord}
              onSetKnown={(row, known) => {
                void onSetKnown(row, known);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
