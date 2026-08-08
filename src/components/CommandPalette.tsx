import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { TreeNode } from "../lib/vaultApi";
import { RECENT_FILES_LIMIT } from "../lib/settingsStore";

export type CommandPaletteMode = "files" | "commands";

export type PaletteCommand = {
  id: string;
  label: string;
  /** Extra text matched by substring search (not shown). */
  keywords?: string;
};

type Props = {
  open: boolean;
  mode: CommandPaletteMode;
  tree: TreeNode | null;
  recentPaths: string[];
  commands: PaletteCommand[];
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onRunCommand: (id: string) => void;
};

const FILE_RESULT_LIMIT = 80;

function collectFilePaths(node: TreeNode, out: string[] = []): string[] {
  if (!node.isDir && node.path) out.push(node.path);
  for (const child of node.children ?? []) collectFilePaths(child, out);
  return out;
}

function fileName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function pathMatches(path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return path.toLowerCase().includes(q);
}

function commandMatches(cmd: PaletteCommand, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (cmd.label.toLowerCase().includes(q)) return true;
  if (cmd.keywords?.toLowerCase().includes(q)) return true;
  return false;
}

type ListItem =
  | { kind: "file"; path: string }
  | { kind: "command"; id: string; label: string }
  | { kind: "heading"; label: string };

type SavedFocus = {
  el: HTMLElement;
  selectionStart?: number;
  selectionEnd?: number;
  range?: Range | null;
};

function captureFocus(): SavedFocus | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return {
      el,
      selectionStart: el.selectionStart ?? undefined,
      selectionEnd: el.selectionEnd ?? undefined,
    };
  }
  let range: Range | null = null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    try {
      range = sel.getRangeAt(0).cloneRange();
    } catch {
      range = null;
    }
  }
  return { el, range };
}

function restoreFocus(saved: SavedFocus | null) {
  if (!saved?.el.isConnected) return;
  try {
    saved.el.focus({ preventScroll: true });
  } catch {
    return;
  }
  if (
    saved.el instanceof HTMLInputElement ||
    saved.el instanceof HTMLTextAreaElement
  ) {
    if (saved.selectionStart != null && saved.selectionEnd != null) {
      try {
        saved.el.setSelectionRange(saved.selectionStart, saved.selectionEnd);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (!saved.range) return;
  const sel = window.getSelection();
  if (!sel) return;
  try {
    sel.removeAllRanges();
    sel.addRange(saved.range);
  } catch {
    /* range may be stale after DOM edits */
  }
}

export function CommandPalette({
  open,
  mode,
  tree,
  recentPaths,
  commands,
  onClose,
  onOpenFile,
  onRunCommand,
}: Props) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const savedFocusRef = useRef<SavedFocus | null>(null);
  const shouldRestoreFocusRef = useRef(true);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  selectedIndexRef.current = selectedIndex;

  const closePalette = (restoreFocusToEditor: boolean) => {
    shouldRestoreFocusRef.current = restoreFocusToEditor;
    onClose();
  };

  const allFiles = useMemo(
    () => (tree ? collectFilePaths(tree) : []),
    [tree],
  );
  const fileSet = useMemo(() => new Set(allFiles), [allFiles]);

  const items = useMemo((): ListItem[] => {
    if (mode === "commands") {
      return commands
        .filter((c) => commandMatches(c, query))
        .map((c) => ({
          kind: "command" as const,
          id: c.id,
          label: c.label,
        }));
    }

    const q = query.trim();
    if (!q) {
      const recent = recentPaths
        .filter((p) => fileSet.has(p))
        .slice(0, RECENT_FILES_LIMIT);
      if (recent.length === 0) {
        return allFiles.slice(0, RECENT_FILES_LIMIT).map((path) => ({
          kind: "file" as const,
          path,
        }));
      }
      return [
        { kind: "heading", label: "Recent" },
        ...recent.map((path) => ({ kind: "file" as const, path })),
      ];
    }

    return allFiles
      .filter((p) => pathMatches(p, q))
      .slice(0, FILE_RESULT_LIMIT)
      .map((path) => ({ kind: "file" as const, path }));
  }, [allFiles, commands, fileSet, mode, query, recentPaths]);

  const selectable = useMemo(
    () =>
      items.filter(
        (i): i is Exclude<ListItem, { kind: "heading" }> =>
          i.kind !== "heading",
      ),
    [items],
  );

  useLayoutEffect(() => {
    if (open) {
      // Keep the first capture for this open session (Strict Mode remounts).
      if (!savedFocusRef.current) {
        savedFocusRef.current = captureFocus();
      }
      shouldRestoreFocusRef.current = true;
      return;
    }
    const saved = savedFocusRef.current;
    savedFocusRef.current = null;
    if (!shouldRestoreFocusRef.current) return;
    // After the palette unmounts from the DOM, put caret/selection back.
    restoreFocus(saved);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, mode]);

  useLayoutEffect(() => {
    setSelectedIndex(0);
  }, [query, mode, items.length]);

  useEffect(() => {
    if (selectable.length === 0) return;
    setSelectedIndex((i) => Math.min(i, selectable.length - 1));
  }, [selectable.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closePalette(true);
        return;
      }
      if (selectable.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i + 1) % selectable.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(
          (i) => (i - 1 + selectable.length) % selectable.length,
        );
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const choice = selectable[selectedIndexRef.current] ?? selectable[0];
        if (!choice) return;
        e.preventDefault();
        e.stopPropagation();
        if (choice.kind === "file") {
          onOpenFile(choice.path);
        } else {
          onRunCommand(choice.id);
        }
        closePalette(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose, onOpenFile, onRunCommand, selectable]);

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex, selectable]);

  if (!open) return null;

  let selectableIdx = -1;
  const emptyLabel =
    mode === "commands"
      ? query.trim()
        ? "No matching commands"
        : "No commands"
      : query.trim()
        ? "No matching files"
        : "No recent files";

  return createPortal(
    <div className="command-palette-root" role="presentation">
      <button
        type="button"
        className="command-palette-backdrop"
        aria-label="Close"
        onClick={() => closePalette(true)}
      />
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="command-palette-sr-only">
          {mode === "commands" ? "Command palette" : "Quick open"}
        </h2>
        <div className="command-palette-input-wrap">
          {mode === "commands" ? (
            <span className="command-palette-prefix" aria-hidden="true">
              &gt;
            </span>
          ) : null}
          <input
            ref={inputRef}
            className="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "commands"
                ? "Type a command…"
                : "Search files by name…"
            }
            aria-autocomplete="list"
            aria-controls={`${titleId}-list`}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div
          ref={listRef}
          id={`${titleId}-list`}
          className="command-palette-list"
          role="listbox"
          aria-label={mode === "commands" ? "Commands" : "Files"}
        >
          {selectable.length === 0 ? (
            <div className="command-palette-empty">{emptyLabel}</div>
          ) : (
            items.map((item, i) => {
              if (item.kind === "heading") {
                return (
                  <div
                    key={`h-${item.label}-${i}`}
                    className="command-palette-heading"
                  >
                    {item.label}
                  </div>
                );
              }
              selectableIdx += 1;
              const idx = selectableIdx;
              const active = idx === selectedIndex;
              if (item.kind === "file") {
                const name = fileName(item.path);
                const dir = parentDir(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-active={active || undefined}
                    className={
                      active
                        ? "command-palette-item is-active"
                        : "command-palette-item"
                    }
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => {
                      onOpenFile(item.path);
                      closePalette(false);
                    }}
                  >
                    <span className="command-palette-item-name">{name}</span>
                    {dir ? (
                      <span className="command-palette-item-path">{dir}</span>
                    ) : null}
                  </button>
                );
              }
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-active={active || undefined}
                  className={
                    active
                      ? "command-palette-item is-active"
                      : "command-palette-item"
                  }
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    onRunCommand(item.id);
                    closePalette(false);
                  }}
                >
                  <span className="command-palette-item-name">{item.label}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
