import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  closeDocumentFind,
  stepDocumentFind,
} from "../editor/find/documentFindController";
import { useDocumentFindStore } from "../store/documentFindStore";

function MatchCaseIcon() {
  return <span className="document-find-case-label">Aa</span>;
}

function ChevronUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 10 8 5.5 12.5 10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 6 8 10.5 12.5 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DocumentFindBar() {
  const query = useDocumentFindStore((s) => s.query);
  const matchCase = useDocumentFindStore((s) => s.matchCase);
  const activeIndex = useDocumentFindStore((s) => s.activeIndex);
  const matchCount = useDocumentFindStore((s) => s.matchCount);
  const focusSeq = useDocumentFindStore((s) => s.focusSeq);
  const setQuery = useDocumentFindStore((s) => s.setQuery);
  const setMatchCase = useDocumentFindStore((s) => s.setMatchCase);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (el.offsetParent === null) return;
    el.focus();
    el.select();
  }, [focusSeq]);

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeDocumentFind();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      stepDocumentFind(e.shiftKey ? -1 : 1);
    }
  };

  const status = !query
    ? null
    : matchCount === 0
      ? "No results"
      : `${activeIndex + 1} of ${matchCount}`;

  const navDisabled = matchCount <= 0;

  return (
    <div className="document-find-bar" role="search">
      <input
        ref={inputRef}
        type="text"
        className="document-find-input"
        value={query}
        placeholder="Find in note…"
        aria-label="Find in note"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onInputKeyDown}
      />
      <button
        type="button"
        className={
          matchCase
            ? "document-find-btn is-toggle is-active"
            : "document-find-btn is-toggle"
        }
        title="Match Case"
        aria-label="Match Case"
        aria-pressed={matchCase}
        onClick={() => setMatchCase(!matchCase)}
      >
        <MatchCaseIcon />
      </button>
      {status ? (
        <span
          className={
            matchCount === 0
              ? "document-find-status is-empty"
              : "document-find-status"
          }
          aria-live="polite"
        >
          {status}
        </span>
      ) : null}
      <button
        type="button"
        className="document-find-btn"
        title="Previous match (Shift+F3)"
        aria-label="Previous match"
        disabled={navDisabled}
        onClick={() => stepDocumentFind(-1)}
      >
        <ChevronUpIcon />
      </button>
      <button
        type="button"
        className="document-find-btn"
        title="Next match (F3)"
        aria-label="Next match"
        disabled={navDisabled}
        onClick={() => stepDocumentFind(1)}
      >
        <ChevronDownIcon />
      </button>
      <button
        type="button"
        className="document-find-btn"
        title="Close (Escape)"
        aria-label="Close find"
        onClick={() => closeDocumentFind()}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
