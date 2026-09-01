import type { ReactNode } from "react";
import { INCOMING_FOLDER } from "../lib/vaultApi";
import { CommentsListSticky } from "./TreeToolbar";
import { IncomingSectionIcon } from "./treeIcons";

export function IncomingSection({
  expanded,
  selected,
  hasChildren,
  captureCount,
  listMode,
  onListModeChange,
  onToggle,
  onOpenIncoming,
  onContextMenu,
  listContent,
  children,
}: {
  expanded: boolean;
  selected: boolean;
  hasChildren: boolean;
  captureCount: number;
  listMode: boolean;
  onListModeChange: (next: boolean) => void;
  onToggle: () => void;
  onOpenIncoming: () => void;
  onContextMenu: (x: number, y: number) => void;
  listContent: ReactNode;
  children: ReactNode;
}) {
  const showBody = expanded && (listMode || hasChildren);

  return (
    <div className="incoming-section">
      <div
        className={[
          "incoming-section-header",
          selected ? "is-selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span
          role="button"
          tabIndex={0}
          className="tree-chevron-btn"
          aria-label={expanded ? "Collapse Incoming" : "Expand Incoming"}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onToggle();
            }
          }}
        >
          <ChevronIcon open={expanded} />
        </span>
        <span className="incoming-section-icon" aria-hidden>
          <IncomingSectionIcon />
        </span>
        <button
          type="button"
          className="incoming-section-title-btn"
          onClick={onOpenIncoming}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e.clientX, e.clientY);
          }}
        >
          <span>{INCOMING_FOLDER}</span>
          {captureCount > 0 ? (
            <span className="incoming-section-count">{captureCount}</span>
          ) : null}
        </button>
        <div className="section-header-actions">
          <CommentsListSticky
            active={listMode}
            onToggle={() => onListModeChange(!listMode)}
          />
        </div>
      </div>
      {showBody ? (
        <div className="incoming-section-body">
          {listMode ? listContent : children}
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "tree-chevron-icon is-open" : "tree-chevron-icon"}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 3.75 10.25 8 6 12.25"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
