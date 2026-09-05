/** Heading outline (TOC) for TipTap live documents, levels 1–3. */

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildOutlineTree,
  collectExpandableKeys,
  type OutlineHeading,
  type OutlineNode,
} from "../lib/documentOutline";
import { saveDocOutlineCollapsed, loadDocOutlineUi } from "../lib/outlineUiState";

type Props = {
  editor: Editor;
  width: number;
  notePath: string;
  vaultPath: string | null;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "outline-chevron is-open" : "outline-chevron"}
      width="14"
      height="14"
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

function CollapseAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 5.25 8 9.75l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 9.25 8 13.75l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OutlineItem({
  node,
  collapsed,
  onToggle,
  onNavigate,
}: {
  node: OutlineNode;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  onNavigate: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const open = hasChildren && !collapsed.has(node.key);

  return (
    <li className={`outline-item level-${node.level}`}>
      <div className="outline-row">
        {hasChildren ? (
          <button
            type="button"
            className="outline-toggle"
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
            onClick={() => onToggle(node.key)}
          >
            <ChevronIcon open={open} />
          </button>
        ) : (
          <span className="outline-toggle-spacer" aria-hidden="true" />
        )}
        <a
          className="outline-link"
          href={`#${node.id}`}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(node.id);
          }}
        >
          {node.text}
        </a>
      </div>
      {hasChildren && open ? (
        <ul className="outline-children">
          {node.children.map((child) => (
            <OutlineItem
              key={child.key}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Collect h1–h3 from a TipTap doc (`heading` nodes with `attrs.level`). */
export function collectTiptapOutlineHeadings(
  editor: Editor,
): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level);
    if (level < 1 || level > 3) return false;
    const text = node.textContent.trim() || "Untitled";
    out.push({
      id: `pos:${pos}`,
      level: level as 1 | 2 | 3,
      text,
    });
    return false;
  });
  return out;
}

export function buildTiptapDocumentOutline(editor: Editor): OutlineNode[] {
  return buildOutlineTree(collectTiptapOutlineHeadings(editor));
}

export function DocumentOutline({
  editor,
  width,
  notePath,
  vaultPath,
}: Props) {
  const [tree, setTree] = useState<OutlineNode[]>(() =>
    buildTiptapDocumentOutline(editor),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(loadDocOutlineUi(vaultPath, notePath).collapsed),
  );
  const outlineTimerRef = useRef<number | null>(null);

  const persistCollapsed = useCallback(
    (next: Set<string>) => {
      saveDocOutlineCollapsed(vaultPath, notePath, next);
    },
    [vaultPath, notePath],
  );

  const refresh = useCallback(() => {
    setTree(buildTiptapDocumentOutline(editor));
  }, [editor]);

  useEffect(() => {
    const onUpdate = () => {
      if (outlineTimerRef.current != null) {
        window.clearTimeout(outlineTimerRef.current);
      }
      outlineTimerRef.current = window.setTimeout(() => {
        outlineTimerRef.current = null;
        refresh();
      }, 200);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (outlineTimerRef.current != null) {
        window.clearTimeout(outlineTimerRef.current);
        outlineTimerRef.current = null;
      }
    };
  }, [editor, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onToggle = useCallback(
    (key: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persistCollapsed(next);
        return next;
      });
    },
    [persistCollapsed],
  );

  const collapseAll = useCallback(() => {
    const next = new Set(collectExpandableKeys(tree));
    setCollapsed(next);
    persistCollapsed(next);
  }, [tree, persistCollapsed]);

  const onNavigate = useCallback(
    (id: string) => {
      const m = /^pos:(\d+)$/.exec(id);
      if (!m) return;
      const pos = Number(m[1]);
      if (!Number.isFinite(pos)) return;
      const view = editor.view;
      try {
        const node = view.state.doc.nodeAt(pos);
        if (!node) return;
        const dom = view.nodeDOM(pos);
        if (dom instanceof HTMLElement) {
          dom.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        const sel = TextSelection.near(view.state.doc.resolve(pos + 1));
        view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
        view.focus();
      } catch {
        /* doc changed */
      }
    },
    [editor],
  );

  return (
    <nav
      className="document-outline"
      aria-label="Document outline"
      style={{ width, flexBasis: width }}
    >
      <div className="outline-toolbar">
        <div className="outline-toolbar-actions">
          <button
            type="button"
            className="outline-toolbar-btn"
            title="Collapse all"
            aria-label="Collapse all"
            disabled={tree.length === 0}
            onClick={collapseAll}
          >
            <CollapseAllIcon />
          </button>
        </div>
      </div>
      <div className="outline-scroll">
        {tree.length === 0 ? (
          <p className="outline-empty">No headings</p>
        ) : (
          <ul className="outline-tree">
            {tree.map((node) => (
              <OutlineItem
                key={node.key}
                node={node}
                collapsed={collapsed}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
