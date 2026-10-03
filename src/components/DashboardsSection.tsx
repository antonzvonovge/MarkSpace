import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { emptyDashboard, pickDashboardColor } from "../lib/dashboardFormat";
import type { TreeNode } from "../lib/vaultApi";
import {
  DASHBOARDS_FOLDER,
  ensureFolder,
  writeNote,
} from "../lib/vaultApi";
import {
  loadDashboardColor,
  useDashboardColorStore,
} from "../store/dashboardColorStore";
import { useVaultStore } from "../store/vaultStore";
import { ConfirmDialog } from "./AppDialog";
import { DashboardIcon } from "./dashboardIcon";
import { PlusIcon } from "./treeIcons";
import { SectionCollapseChevron } from "./sidebar/SectionCollapseChevron";

const DASHBOARDS_COLLAPSED_KEY = "markspace-dashboards-section-collapsed-v1";

function loadDashboardsCollapsed(): boolean {
  try {
    return localStorage.getItem(DASHBOARDS_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveDashboardsCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(DASHBOARDS_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

function dashboardFiles(tree: TreeNode | null): { path: string; name: string }[] {
  const folder = tree?.children?.find((node) => node.path === DASHBOARDS_FOLDER);
  const files = (folder?.children ?? []).filter(
    (node) => !node.isDir && node.name.toLowerCase().endsWith(".dashboard"),
  );
  return files
    .map((node) => ({
      path: node.path,
      name: node.name.replace(/\.dashboard$/i, ""),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function nextDashboardPath(tree: TreeNode | null): string {
  const taken = new Set(dashboardFiles(tree).map((file) => file.name.toLowerCase()));
  let name = "New dashboard";
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    name = `New dashboard ${n}`;
    n += 1;
  }
  return `${DASHBOARDS_FOLDER}/${name}.dashboard`;
}

function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const committed = useRef(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const finish = (action: () => void) => {
    if (committed.current) return;
    committed.current = true;
    inputRef.current?.blur();
    action();
  };

  const commit = () => {
    const next = value.trim();
    if (!next || next === initialValue) {
      finish(() => onCancel());
      return;
    }
    finish(() => onCommit(next));
  };

  return (
    <input
      ref={inputRef}
      className="tree-rename-input"
      value={value}
      spellCheck={false}
      aria-label="Rename dashboard"
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(() => onCancel());
        }
      }}
      onBlur={commit}
    />
  );
}

function DashboardRowIcon({ path }: { path: string }) {
  const color = useDashboardColorStore((s) => s.byPath[path] ?? "");
  return (
    <span
      className="routines-row-icon is-dashboard"
      style={color ? { color } : undefined}
      aria-hidden="true"
    >
      <DashboardIcon size={16} />
    </span>
  );
}

function DashboardContextMenu({
  x,
  y,
  isFavorite,
  onClose,
  onToggleFavorite,
  onRename,
  onDelete,
}: {
  x: number;
  y: number;
  isFavorite: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 140);

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu is-plaintext"
      role="menu"
      style={{ left, top }}
    >
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        onClick={() => {
          onClose();
          onToggleFavorite();
        }}
      >
        {isFavorite ? "Remove from favorites" : "Add to favorites"}
      </button>
      <div className="tree-context-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        Rename
      </button>
      <div className="tree-context-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="tree-context-item is-danger"
        onClick={() => {
          onClose();
          onDelete();
        }}
      >
        Delete
      </button>
    </div>,
    document.body,
  );
}

export const DashboardsSection = memo(function DashboardsSection() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const favoritePaths = useVaultStore((s) => s.favoritePaths);
  const tree = useVaultStore((s) => s.tree);
  const activePath = useVaultStore((s) => s.activePath);
  const openNote = useVaultStore((s) => s.openNote);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const renameTreeEntry = useVaultStore((s) => s.renameTreeEntry);
  const removePath = useVaultStore((s) => s.removePath);
  const [sectionCollapsed, setSectionCollapsed] = useState(loadDashboardsCollapsed);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ path: string; name: string; x: number; y: number } | null>(
    null,
  );
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const creating = useRef(false);

  const files = useMemo(() => dashboardFiles(tree), [tree]);
  const pathKey = files.map((file) => file.path).join("\n");
  const confirmName = files.find((file) => file.path === confirmPath)?.name;

  useEffect(() => {
    const paths = pathKey ? pathKey.split("\n") : [];
    useDashboardColorStore.getState().dropMissing(paths);
    for (const path of paths) void loadDashboardColor(path);
  }, [pathKey]);

  const openDashboard = useCallback(
    (path: string) => {
      void openNote(path, { preview: false, syncTreeSelection: false });
    },
    [openNote],
  );

  const createDashboard = useCallback(() => {
    if (!vaultPath || creating.current) return;
    creating.current = true;
    const path = nextDashboardPath(useVaultStore.getState().tree);
    const color = pickDashboardColor();
    useDashboardColorStore.getState().note(path, color);
    void (async () => {
      try {
        await ensureFolder(DASHBOARDS_FOLDER);
        await writeNote(path, emptyDashboard(color));
        await refreshTree();
        await openNote(path, { preview: false, syncTreeSelection: false });
      } catch (err) {
        useVaultStore.setState({
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        creating.current = false;
      }
    })();
  }, [openNote, refreshTree, vaultPath]);

  return (
    <div className="routines-section dashboards-section">
      <div className="routines-section-header">
        <SectionCollapseChevron
          open={!sectionCollapsed}
          label="Dashboards"
          onToggle={() => {
            setSectionCollapsed((prev) => {
              const next = !prev;
              saveDashboardsCollapsed(next);
              return next;
            });
          }}
        />
        <span className="routines-section-header-icon" aria-hidden="true">
          <DashboardIcon />
        </span>
        <span className="routines-section-title">Dashboards</span>
        <div
          className="section-header-actions"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="tree-toolbar-btn"
            title="New dashboard"
            aria-label="New dashboard"
            disabled={!vaultPath}
            onClick={createDashboard}
          >
            <PlusIcon />
          </button>
        </div>
      </div>
      {sectionCollapsed || files.length === 0 ? null : (
        <ul className="routines-list">
          {files.map((file) => {
            const renaming = renamingPath === file.path;
            const selected = activePath === file.path;
            return (
              <li
                key={file.path}
                className={[
                  "routines-row-line",
                  selected ? "is-selected" : "",
                  renaming ? "is-renaming" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div
                  className="routines-row"
                  role={renaming ? undefined : "button"}
                  tabIndex={renaming ? undefined : 0}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => {
                    if (renaming) return;
                    openDashboard(file.path);
                  }}
                  onKeyDown={(event) => {
                    if (renaming) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openDashboard(file.path);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMenu({ path: file.path, name: file.name, x: event.clientX, y: event.clientY });
                  }}
                >
                  <DashboardRowIcon path={file.path} />
                  {renaming ? (
                    <InlineRenameInput
                      key={file.path}
                      initialValue={file.name}
                      onCancel={() => setRenamingPath(null)}
                      onCommit={(name) => {
                        setRenamingPath(null);
                        const stem = name.trim().replace(/\.dashboard$/i, "");
                        if (!stem) return;
                        void renameTreeEntry(file.path, `${stem}.dashboard`);
                      }}
                    />
                  ) : (
                    <span className="routines-row-label">{file.name}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {sectionCollapsed || !vaultPath || files.length > 0 ? null : (
        <p className="routines-empty">No dashboards yet</p>
      )}
      {menu ? (
        <DashboardContextMenu
          x={menu.x}
          y={menu.y}
          isFavorite={favoritePaths.includes(menu.path)}
          onClose={() => setMenu(null)}
          onToggleFavorite={() => {
            const path = menu.path;
            const store = useVaultStore.getState();
            if (store.isFavorite(path)) void store.removeFromFavorites(path);
            else void store.addToFavorites(path);
          }}
          onRename={() => setRenamingPath(menu.path)}
          onDelete={() => setConfirmPath(menu.path)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmPath != null}
        title="Delete dashboard"
        description={`Delete “${confirmName ?? "this dashboard"}”? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmPath(null)}
        onConfirm={() => {
          const path = confirmPath;
          setConfirmPath(null);
          if (!path) return;
          if (renamingPath === path) setRenamingPath(null);
          void removePath(path);
        }}
      />
    </div>
  );
});
