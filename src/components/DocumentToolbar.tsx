import { useCallback, useState } from "react";
import { startLexiconArticleJob } from "../ai/lexiconArticle";
import { quickTranslateLanguageLabel } from "../ai/quickTranslate";
import { vaultProjectRootOf } from "../lib/diaryNotes";
import { formatToolbarPath } from "../lib/documentPath";
import {
  isVaultLexiconMdNote,
  stubResultFromLexiconNote,
} from "../lib/lexiconNotes";
import { nativeLanguageLabel } from "../settings/types";
import {
  loadQuickTranslateCache,
  lookupCachedTranslationByNotePath,
} from "../lib/quickTranslateCache";
import { documentKind, readNote } from "../lib/vaultApi";
import { useBackgroundJobsStore } from "../store/backgroundJobsStore";
import { useDocumentFindStore } from "../store/documentFindStore";
import { usePrefsStore } from "../store/prefsStore";
import { useVaultStore, type ViewMode, isIncomingTab } from "../store/vaultStore";
import { DocumentFindBar } from "./DocumentFindBar";

const MODES: { mode: ViewMode; label: string }[] = [
  { mode: "live", label: "Live" },
  { mode: "source", label: "Source" },
];

function OutlineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 3.5h10M3 8h7M3 12.5h10"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="1.5" cy="3.5" r="0.85" fill="currentColor" />
      <circle cx="1.5" cy="8" r="0.85" fill="currentColor" />
      <circle cx="1.5" cy="12.5" r="0.85" fill="currentColor" />
    </svg>
  );
}

function CommentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 3.25h9A1.25 1.25 0 0 1 13.75 4.5v5A1.25 1.25 0 0 1 12.5 10.75H7.1L4.4 13.1a.4.4 0 0 1-.65-.31V10.75H3.5A1.25 1.25 0 0 1 2.25 9.5v-5A1.25 1.25 0 0 1 3.5 3.25Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Props = {
  /** Show outline toggle in Live mode (markdown only). Default true. */
  showOutlineToggle?: boolean;
  /** Show comments toggle in Live mode (markdown only). Default true. */
  showCommentsToggle?: boolean;
};

function LexiconTranslateToolbarButton({ path }: { path: string }) {
  const [starting, setStarting] = useState(false);
  const nativeLanguage = usePrefsStore((s) => s.prefs.nativeLanguage);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const saveActive = useVaultStore((s) => s.saveActive);
  const jobRunning = useBackgroundJobsStore((s) => {
    const job = s.jobs[`lexicon-article:${path}`];
    return job?.status === "running";
  });
  const busy = starting || jobRunning;

  const onClick = useCallback(async () => {
    if (busy) return;
    const projectPath = vaultProjectRootOf(path);
    if (!projectPath) return;
    setStarting(true);
    try {
      await saveActive();
      const props = projectPropertiesByPath[projectPath];
      const markdown = await readNote(path);
      const cache = await loadQuickTranslateCache();
      const cached = lookupCachedTranslationByNotePath(cache, path);
      const foreign =
        (props?.learningLanguage ?? "").trim().toLowerCase() ||
        (typeof cached?.result.queryLang === "string"
          ? cached.result.queryLang
          : "") ||
        "en";
      const result =
        cached?.result ?? stubResultFromLexiconNote(markdown, path, foreign);
      startLexiconArticleJob({
        notePath: path,
        projectPath,
        result,
        foreignLanguageCode: foreign,
        foreignLanguageLabel: quickTranslateLanguageLabel(foreign),
        nativeLanguageCode: nativeLanguage,
        nativeLanguageLabel: nativeLanguageLabel(nativeLanguage),
      });
    } finally {
      setStarting(false);
    }
  }, [
    busy,
    nativeLanguage,
    path,
    projectPropertiesByPath,
    saveActive,
  ]);

  return (
    <button
      type="button"
      className="document-toolbar-text-btn"
      disabled={busy}
      title="Regenerate the lexicon article"
      aria-label="Translate"
      onClick={() => void onClick()}
    >
      Translate
    </button>
  );
}

export function DocumentToolbar({
  showOutlineToggle = true,
  showCommentsToggle = true,
}: Props) {
  const activePath = useVaultStore((s) => s.activePath);
  const viewMode = useVaultStore((s) => s.viewMode);
  const setViewMode = useVaultStore((s) => s.setViewMode);
  const showOutline = useVaultStore((s) => s.showOutline);
  const toggleOutline = useVaultStore((s) => s.toggleOutline);
  const showComments = useVaultStore((s) => s.showComments);
  const toggleComments = useVaultStore((s) => s.toggleComments);
  const unresolvedCommentCount = useVaultStore(
    (s) => s.activeNoteComments.filter((c) => !c.resolved).length,
  );
  const incomingActive = useVaultStore((s) => {
    const tab = s.tabs.find((t) => t.path === s.activePath);
    return Boolean(tab && isIncomingTab(tab));
  });

  const findOpen = useDocumentFindStore((s) => s.open);

  const pathLabel =
    activePath && !activePath.startsWith("markspace:")
      ? formatToolbarPath(activePath)
      : null;
  const showFind =
    findOpen &&
    Boolean(activePath) &&
    !activePath?.startsWith("markspace:") &&
    documentKind(activePath!) === "markdown";

  const liveMode = viewMode === "live";
  const showOutlineBtn = liveMode && showOutlineToggle && !incomingActive;
  const showCommentsBtn = liveMode && showCommentsToggle && !incomingActive;

  const commentsBadge =
    unresolvedCommentCount > 99
      ? "99+"
      : unresolvedCommentCount > 0
        ? String(unresolvedCommentCount)
        : null;

  return (
    <div className="document-toolbar">
      {showOutlineBtn ? (
        <button
          type="button"
          className={
            showOutline
              ? "document-toolbar-btn is-outline is-active"
              : "document-toolbar-btn is-outline"
          }
          title="Outline"
          aria-label="Toggle outline"
          aria-pressed={showOutline}
          onClick={() => toggleOutline()}
        >
          <OutlineIcon />
        </button>
      ) : null}
      {showFind ? (
        <DocumentFindBar />
      ) : pathLabel ? (
        <div className="document-toolbar-path" title={activePath ?? undefined}>
          {pathLabel}
        </div>
      ) : (
        <div className="document-toolbar-path is-empty" />
      )}
      <div className="document-toolbar-actions">
        {incomingActive ? null : (
          <>
            {activePath && isVaultLexiconMdNote(activePath) ? (
              <LexiconTranslateToolbarButton path={activePath} />
            ) : null}
            <div
              className="view-mode-switch"
              role="radiogroup"
              aria-label="Editor view mode"
            >
              {MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={viewMode === mode}
                  className={[
                    "view-mode-switch-segment",
                    viewMode === mode ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setViewMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {showCommentsBtn ? (
        <button
          type="button"
          className={
            showComments
              ? "document-toolbar-btn is-comments is-active has-badge"
              : commentsBadge
                ? "document-toolbar-btn is-comments has-badge"
                : "document-toolbar-btn is-comments"
          }
          title={
            commentsBadge
              ? `Comments (${unresolvedCommentCount} open)`
              : "Comments"
          }
          aria-label={
            commentsBadge
              ? `Toggle comments, ${unresolvedCommentCount} open`
              : "Toggle comments"
          }
          aria-pressed={showComments}
          onClick={() => toggleComments()}
        >
          <CommentsIcon />
          {commentsBadge ? (
            <span className="document-toolbar-badge" aria-hidden="true">
              {commentsBadge}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}
