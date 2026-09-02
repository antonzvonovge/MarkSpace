import { useCallback, useMemo, useState } from "react";
import { FcDocument, FcFolder, FcOpenedFolder, FcPackage } from "react-icons/fc";
import type { CommentRef } from "../lib/vaultApi";
import { isVaultProjectFolder } from "../lib/vaultApi";
import { commentQuoteLabel } from "../lib/commentAnchors";
import {
  loadCommentsInboxCollapsed,
  loadCommentsInboxList,
  loadCommentsInboxShowResolved,
  saveCommentsInboxCollapsed,
  saveCommentsInboxList,
  saveCommentsInboxShowResolved,
} from "../lib/commentsUiState";
import { useVaultStore } from "../store/vaultStore";
import {
  CommentsListSticky,
  CommentsResolvedSticky,
  SectionCollapseButton,
} from "./TreeToolbar";
import { CommentsSectionIcon } from "./treeIcons";

type FolderNode = {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  notes: Map<string, CommentRef[]>;
};

function buildCommentsTree(refs: CommentRef[]): FolderNode {
  const root: FolderNode = {
    name: "",
    path: "",
    folders: new Map(),
    notes: new Map(),
  };

  for (const ref of refs) {
    const parts = ref.notePath.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!;
      const folderPath = parts.slice(0, i + 1).join("/");
      let next = cursor.folders.get(name);
      if (!next) {
        next = {
          name,
          path: folderPath,
          folders: new Map(),
          notes: new Map(),
        };
        cursor.folders.set(name, next);
      }
      cursor = next;
    }
    const noteName = parts[parts.length - 1]!;
    const list = cursor.notes.get(noteName) ?? [];
    list.push(ref);
    cursor.notes.set(noteName, list);
  }

  return root;
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

function InboxChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "comments-inbox-chevron is-open" : "comments-inbox-chevron"}
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

function snippet(text: string, max = 48): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function noteStem(path: string): string {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return name.replace(/\.md$/i, "");
}

function commentLabel(ref: CommentRef): string {
  return ref.comment.body || commentQuoteLabel(ref.comment.quote);
}

function sortCommentRefs(a: CommentRef, b: CommentRef): number {
  const byPath = a.notePath.localeCompare(b.notePath);
  if (byPath !== 0) return byPath;
  return a.comment.createdAt.localeCompare(b.comment.createdAt);
}

function rowPad(depth: number): string {
  // +1 — align with first branch under vault root.
  return `calc(var(--tree-pad-x) + ${depth + 1} * var(--tree-indent))`;
}

export function CommentsInboxSection() {
  const allComments = useVaultStore((s) => s.allComments);
  const openComment = useVaultStore((s) => s.openComment);
  const [showResolved, setShowResolved] = useState(
    () => loadCommentsInboxShowResolved(),
  );
  const [listMode, setListMode] = useState(() => loadCommentsInboxList());
  const [collapsed, setCollapsed] = useState(() => loadCommentsInboxCollapsed());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const visible = useMemo(
    () =>
      showResolved
        ? allComments
        : allComments.filter((r) => !r.comment.resolved),
    [allComments, showResolved],
  );

  const tree = useMemo(() => buildCommentsTree(visible), [visible]);
  const list = useMemo(
    () => [...visible].sort(sortCommentRefs),
    [visible],
  );

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onShowResolvedChange = useCallback((next: boolean) => {
    setShowResolved(next);
    saveCommentsInboxShowResolved(next);
  }, []);

  const onListModeChange = useCallback((next: boolean) => {
    setListMode(next);
    saveCommentsInboxList(next);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      saveCommentsInboxCollapsed(next);
      return next;
    });
  }, []);

  const collapseToTopLevel = useCallback(() => {
    setExpanded(new Set());
  }, []);

  if (allComments.length === 0) return null;

  const openCount = allComments.filter((r) => !r.comment.resolved).length;

  return (
    <div className="comments-inbox-section">
      <div className="comments-inbox-header">
        <span
          role="button"
          tabIndex={0}
          className="tree-chevron-btn"
          aria-label={collapsed ? "Expand comments" : "Collapse comments"}
          aria-expanded={!collapsed}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapsed();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              toggleCollapsed();
            }
          }}
        >
          <ChevronIcon open={!collapsed} />
        </span>
        <span className="comments-inbox-header-icon" aria-hidden>
          <CommentsSectionIcon />
        </span>
        <button
          type="button"
          className="comments-inbox-title-btn"
          onClick={toggleCollapsed}
        >
          <span>Comments</span>
          {openCount > 0 ? (
            <span className="comments-inbox-header-count">{openCount}</span>
          ) : null}
        </button>
        <div className="section-header-actions">
          <CommentsListSticky
            active={listMode}
            onToggle={() => onListModeChange(!listMode)}
          />
          <CommentsResolvedSticky
            active={showResolved}
            onToggle={() => onShowResolvedChange(!showResolved)}
          />
          {!listMode ? (
            <SectionCollapseButton
              onCollapse={collapseToTopLevel}
              disabled={expanded.size === 0}
              title="Collapse to top level"
            />
          ) : null}
        </div>
      </div>
      {!collapsed ? (
        visible.length === 0 ? (
          <p className="comments-inbox-empty">No open comments</p>
        ) : (
          <div className="comments-inbox-tree">
            {listMode ? (
              <CommentListRows
                refs={list}
                onOpenComment={(notePath, id) => {
                  void openComment(notePath, id);
                }}
              />
            ) : (
              <FolderRows
                node={tree}
                depth={0}
                expanded={expanded}
                onToggle={toggleExpanded}
                onOpenComment={(notePath, id) => {
                  void openComment(notePath, id);
                }}
              />
            )}
          </div>
        )
      ) : null}
    </div>
  );
}

function CommentListRows({
  refs,
  onOpenComment,
}: {
  refs: CommentRef[];
  onOpenComment: (notePath: string, commentId: string) => void;
}) {
  return (
    <>
      {refs.map((ref) => {
        const text = commentLabel(ref);
        return (
          <button
            key={`${ref.notePath}:${ref.comment.id}`}
            type="button"
            className={
              ref.comment.resolved
                ? "comments-inbox-row is-comment is-list-item is-resolved"
                : "comments-inbox-row is-comment is-list-item"
            }
            title={`${text}\n${ref.notePath}`}
            onClick={() => onOpenComment(ref.notePath, ref.comment.id)}
          >
            <span className="comments-inbox-row-icon" aria-hidden>
              <CommentsSectionIcon />
            </span>
            <span className="comments-inbox-label">{snippet(text)}</span>
            <span className="comments-inbox-note">{noteStem(ref.notePath)}</span>
          </button>
        );
      })}
    </>
  );
}

function FolderRows({
  node,
  depth,
  expanded,
  onToggle,
  onOpenComment,
}: {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onOpenComment: (notePath: string, commentId: string) => void;
}) {
  const folders = [...node.folders.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const notes = [...node.notes.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <>
      {folders.map((folder) => {
        const key = `folder:${folder.path}`;
        const open = expanded.has(key);
        const isProject = isVaultProjectFolder(folder.path, true);
        return (
          <div key={key} className="comments-inbox-node">
            <button
              type="button"
              className="comments-inbox-row is-folder"
              style={{ paddingLeft: rowPad(depth) }}
              onClick={() => onToggle(key)}
            >
              <span className="comments-inbox-row-chevron">
                <InboxChevron open={open} />
              </span>
              <span className="comments-inbox-row-icon" aria-hidden>
                {isProject ? (
                  <FcPackage size={18} />
                ) : open ? (
                  <FcOpenedFolder size={18} />
                ) : (
                  <FcFolder size={18} />
                )}
              </span>
              <span className="comments-inbox-label">{folder.name}</span>
            </button>
            {open ? (
              <FolderRows
                node={folder}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onOpenComment={onOpenComment}
              />
            ) : null}
          </div>
        );
      })}
      {notes.map(([noteName, refs]) => {
        const notePath = node.path ? `${node.path}/${noteName}` : noteName;
        const key = `note:${notePath}`;
        const open = expanded.has(key);
        const label = noteName.replace(/\.md$/i, "");
        return (
          <div key={key} className="comments-inbox-node">
            <button
              type="button"
              className="comments-inbox-row is-note"
              style={{ paddingLeft: rowPad(depth) }}
              onClick={() => onToggle(key)}
            >
              <span className="comments-inbox-row-chevron">
                <InboxChevron open={open} />
              </span>
              <span className="comments-inbox-row-icon" aria-hidden>
                <FcDocument size={18} />
              </span>
              <span className="comments-inbox-label">{label}</span>
              <span className="comments-inbox-count">{refs.length}</span>
            </button>
            {open
              ? refs.map((ref) => (
                  <button
                    key={ref.comment.id}
                    type="button"
                    className={
                      ref.comment.resolved
                        ? "comments-inbox-row is-comment is-resolved"
                        : "comments-inbox-row is-comment"
                    }
                    style={{ paddingLeft: rowPad(depth + 1) }}
                    title={
                      ref.comment.body || commentQuoteLabel(ref.comment.quote)
                    }
                    onClick={() => onOpenComment(ref.notePath, ref.comment.id)}
                  >
                    <span className="comments-inbox-row-chevron is-spacer" />
                    <span className="comments-inbox-row-icon" aria-hidden>
                      <CommentsSectionIcon />
                    </span>
                    <span className="comments-inbox-label">
                      {snippet(
                        ref.comment.body || commentQuoteLabel(ref.comment.quote),
                      )}
                    </span>
                  </button>
                ))
              : null}
          </div>
        );
      })}
    </>
  );
}
