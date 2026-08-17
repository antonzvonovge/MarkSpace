import { formatToolbarPath } from "../lib/documentPath";
import { documentKind } from "../lib/vaultApi";
import { useDocumentFindStore } from "../store/documentFindStore";
import { useVaultStore, type ViewMode } from "../store/vaultStore";
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
  const showOutlineBtn = liveMode && showOutlineToggle;
  const showCommentsBtn = liveMode && showCommentsToggle;

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
