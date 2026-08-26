import type { ReactNode } from "react";
import { INCOMING_FOLDER } from "../lib/vaultApi";
import { IncomingSectionIcon } from "./treeIcons";

export function IncomingSection({
  expanded,
  selected,
  hasChildren,
  onToggle,
  onOpenIncoming,
  onContextMenu,
  children,
}: {
  expanded: boolean;
  selected: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onOpenIncoming: () => void;
  onContextMenu: (x: number, y: number) => void;
  children: ReactNode;
}) {
  return (
    <div className="incoming-section">
      <div
        className={[
          "tree-row",
          "tree-folder-row",
          "incoming-section-row",
          selected ? "is-selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-vault-path={INCOMING_FOLDER}
        data-vault-isdir="1"
        onClick={() => onOpenIncoming()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e.clientX, e.clientY);
        }}
      >
        <span
          role={hasChildren ? "button" : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          className={hasChildren ? "tree-chevron-btn" : "tree-chevron-btn is-empty"}
          aria-hidden={hasChildren ? undefined : true}
          aria-label={
            hasChildren ? (expanded ? "Collapse" : "Expand") : undefined
          }
          aria-expanded={hasChildren ? expanded : undefined}
          onClick={
            hasChildren
              ? (e) => {
                  e.stopPropagation();
                  onToggle();
                }
              : undefined
          }
          onKeyDown={
            hasChildren
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggle();
                  }
                }
              : undefined
          }
        >
          <ChevronIcon open={expanded} />
        </span>
        <span className="incoming-section-icon" aria-hidden>
          <IncomingSectionIcon />
        </span>
        <span className="tree-node-label">{INCOMING_FOLDER}</span>
      </div>
      {expanded && hasChildren ? children : null}
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
