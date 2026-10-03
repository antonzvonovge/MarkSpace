import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Routine } from "../lib/routinesApi";
import { useRoutinesStore } from "../store/routinesStore";
import { routineIdFromTab, useVaultStore } from "../store/vaultStore";
import { ConfirmDialog } from "./AppDialog";
import { RoutineColorIcon, routineIconColor } from "./routineIcon";
import { PlusIcon } from "./treeIcons";
import { SectionCollapseChevron } from "./sidebar/SectionCollapseChevron";

const ROUTINES_COLLAPSED_KEY = "markspace-routines-section-collapsed-v1";

function loadRoutinesCollapsed(): boolean {
  try {
    return localStorage.getItem(ROUTINES_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveRoutinesCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(ROUTINES_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

function formatNextRun(iso: string | null | undefined, enabled: boolean): string {
  if (!enabled) return "Off";
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RoutineSpinner({ label }: { label?: string }) {
  return (
    <span
      className="routines-spinner"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle
          cx="8"
          cy="8"
          r="5.5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeDasharray="22 10"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M8 4.75V8l2.1 1.4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const lastDot = initialValue.lastIndexOf(".");
      if (lastDot > 0) input.setSelectionRange(0, lastDot);
      else input.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [initialValue]);

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
      aria-label="Rename routine"
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
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

type RoutineMenuState = {
  id: string;
  x: number;
  y: number;
};

function RoutineContextMenu({
  menu,
  running,
  onClose,
  onRename,
  onRun,
  onDelete,
}: {
  menu: RoutineMenuState;
  running: boolean;
  onClose: () => void;
  onRename: () => void;
  onRun: () => void;
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
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const left = Math.min(menu.x, window.innerWidth - 220);
  const top = Math.min(menu.y, window.innerHeight - 160);

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
          onRename();
        }}
      >
        Rename
      </button>
      <div className="tree-context-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        disabled={running}
        onClick={() => {
          onClose();
          onRun();
        }}
      >
        Run
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

const RoutineRow = memo(function RoutineRow({
  routine,
  running,
  selected,
  open,
  renaming,
  onOpen,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
}: {
  routine: Routine;
  running: boolean;
  selected: boolean;
  open: boolean;
  renaming: boolean;
  onOpen: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onRenameCommit: (id: string, name: string) => void;
  onRenameCancel: () => void;
}) {
  return (
    <li
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
        aria-current={open ? "page" : undefined}
        onClick={() => {
          if (renaming) return;
          onOpen(routine.id);
        }}
        onKeyDown={(event) => {
          if (renaming) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(routine.id);
          }
        }}
        onContextMenu={(event) => {
          event.stopPropagation();
          if (renaming) return;
          event.preventDefault();
          onContextMenu(routine.id, event.clientX, event.clientY);
        }}
      >
        <span
          className="routines-row-icon"
          style={{ color: routineIconColor(routine.id) }}
          aria-hidden="true"
        >
          <RoutineColorIcon />
        </span>
        {renaming ? (
          <InlineRenameInput
            key={routine.id}
            initialValue={routine.name}
            onCancel={onRenameCancel}
            onCommit={(name) => onRenameCommit(routine.id, name)}
          />
        ) : (
          <span className="routines-row-label">{routine.name}</span>
        )}
        {renaming ? null : (
          <span className="routines-row-meta">
            {formatNextRun(routine.nextRunAt, routine.enabled)}
          </span>
        )}
        {running ? (
          <span className="routines-row-status">
            <RoutineSpinner label="Running" />
          </span>
        ) : null}
      </div>
    </li>
  );
});

export const RoutinesSection = memo(function RoutinesSection() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const routines = useRoutinesStore((s) => s.routines);
  const runningId = useRoutinesStore((s) => s.runningId);
  const load = useRoutinesStore((s) => s.load);
  const reset = useRoutinesStore((s) => s.reset);
  const runNow = useRoutinesStore((s) => s.runNow);
  const save = useRoutinesStore((s) => s.save);
  const openRoutineTab = useVaultStore((s) => s.openRoutineTab);
  const remove = useRoutinesStore((s) => s.remove);
  const openId = useVaultStore((s) => routineIdFromTab(s.activePath ?? "") ?? "");
  const [sectionCollapsed, setSectionCollapsed] = useState(loadRoutinesCollapsed);
  const [ready, setReady] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<RoutineMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "run" | "delete" } | null>(
    null,
  );

  useEffect(() => {
    if (!vaultPath) {
      reset();
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    reset();
    void load()
      .catch(() => {
        /* vault not ready */
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, load, reset]);

  const openRoutine = useCallback(
    (id: string) => {
      setPickedId(null);
      void openRoutineTab(id);
    },
    [openRoutineTab],
  );

  const openRoutineMenu = useCallback((id: string, x: number, y: number) => {
    setPickedId(id);
    setMenu({ id, x, y });
  }, []);

  const closeRoutineMenu = useCallback(() => setMenu(null), []);

  const renameRoutine = useCallback((id: string, name: string) => {
    setRenamingId(null);
    const routine = useRoutinesStore.getState().routines.find((item) => item.id === id);
    if (!routine) return;
    void save({ id, name, cron: routine.cron });
  }, [save]);

  const createRoutine = useCallback(() => {
    void save({ name: "New routine", cron: "0 9 * * *" }).then((saved) =>
      openRoutineTab(saved.id),
    );
  }, [openRoutineTab, save]);

  const highlightedId = pickedId ?? openId;
  const confirmRoutine = confirm
    ? routines.find((routine) => routine.id === confirm.id)
    : undefined;

  return (
    <div className="routines-section">
      <div className="routines-section-header">
        <SectionCollapseChevron
          open={!sectionCollapsed}
          label="Routines"
          onToggle={() => {
            setSectionCollapsed((prev) => {
              const next = !prev;
              saveRoutinesCollapsed(next);
              return next;
            });
          }}
        />
        <span className="routines-section-header-icon" aria-hidden="true">
          <ClockIcon />
        </span>
        <span className="routines-section-title">Routines</span>
        {runningId ? <RoutineSpinner label="Routine running" /> : null}
        <div
          className="section-header-actions"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="tree-toolbar-btn"
            title="New routine"
            aria-label="New routine"
            disabled={!vaultPath}
            onClick={() => createRoutine()}
          >
            <PlusIcon />
          </button>
        </div>
      </div>
      {!sectionCollapsed && routines.length > 0 ? (
        <ul className="routines-list" role="list">
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              running={runningId === routine.id}
              selected={routine.id === highlightedId}
              open={routine.id === openId}
              renaming={renamingId === routine.id}
              onOpen={openRoutine}
              onContextMenu={openRoutineMenu}
              onRenameCommit={renameRoutine}
              onRenameCancel={() => setRenamingId(null)}
            />
          ))}
        </ul>
      ) : null}
      {sectionCollapsed || !ready || routines.length > 0 ? null : (
        <p className="routines-empty">No routines yet</p>
      )}
      {menu ? (
        <RoutineContextMenu
          menu={menu}
          running={runningId === menu.id}
          onClose={closeRoutineMenu}
          onRename={() => setRenamingId(menu.id)}
          onRun={() => setConfirm({ id: menu.id, kind: "run" })}
          onDelete={() => setConfirm({ id: menu.id, kind: "delete" })}
        />
      ) : null}
      <ConfirmDialog
        open={confirmRoutine != null && confirm != null}
        title={confirm?.kind === "delete" ? "Delete routine" : "Run now"}
        description={
          confirm?.kind === "delete"
            ? `Delete “${confirmRoutine?.name ?? ""}” and its run history? This cannot be undone.`
            : `Run “${confirmRoutine?.name ?? ""}” now?`
        }
        confirmLabel={confirm?.kind === "delete" ? "Delete" : "Run"}
        danger={confirm?.kind === "delete"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (!action) return;
          if (action.kind === "delete") {
            setPickedId((current) => (current === action.id ? null : current));
            if (renamingId === action.id) setRenamingId(null);
            void remove(action.id);
            return;
          }
          void runNow(action.id);
        }}
      />
    </div>
  );
});
