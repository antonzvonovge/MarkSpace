import { memo, useCallback, useEffect, useState } from "react";
import type { Routine } from "../lib/routinesApi";
import { useRoutinesStore } from "../store/routinesStore";
import { routineIdFromTab, useVaultStore } from "../store/vaultStore";
import { PlusIcon } from "./treeIcons";

const COLLAPSED_KEY = "markspace.routinesCollapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
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
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.35" />
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

function SectionChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "tasks-section-chevron is-open" : "tasks-section-chevron"}
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

const RoutineRow = memo(function RoutineRow({
  routine,
  running,
  selected,
  onOpen,
  onRun,
}: {
  routine: Routine;
  running: boolean;
  selected: boolean;
  onOpen: (id: string) => void;
  onRun: (id: string) => void;
}) {
  return (
    <li className={selected ? "routines-row-line is-selected" : "routines-row-line"}>
      <button
        type="button"
        className="routines-row"
        aria-current={selected ? "page" : undefined}
        onClick={() => onOpen(routine.id)}
      >
        <span className="routines-row-label">{routine.name}</span>
        <span className="routines-row-meta">
          {formatNextRun(routine.nextRunAt, routine.enabled)}
        </span>
      </button>
      {running ? (
        <span className="routines-row-run is-status">
          <RoutineSpinner />
        </span>
      ) : (
        <button
          type="button"
          className="routines-row-run"
          title="Run now"
          aria-label={`Run ${routine.name} now`}
          onClick={() => onRun(routine.id)}
        >
          <PlayIcon />
        </button>
      )}
    </li>
  );
});

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5.2 3.4v9.2L13 8 5.2 3.4Z" />
    </svg>
  );
}

export const RoutinesSection = memo(function RoutinesSection() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const routines = useRoutinesStore((s) => s.routines);
  const runningId = useRoutinesStore((s) => s.runningId);
  const load = useRoutinesStore((s) => s.load);
  const reset = useRoutinesStore((s) => s.reset);
  const runNow = useRoutinesStore((s) => s.runNow);
  const save = useRoutinesStore((s) => s.save);
  const openRoutineTab = useVaultStore((s) => s.openRoutineTab);
  const selectedId = useVaultStore((s) => routineIdFromTab(s.activePath ?? "") ?? "");
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [ready, setReady] = useState(false);

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

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  const openRoutine = useCallback(
    (id: string) => {
      void openRoutineTab(id);
    },
    [openRoutineTab],
  );

  const createRoutine = useCallback(() => {
    void save({ name: "New routine", cron: "0 9 * * *" }).then((saved) =>
      openRoutineTab(saved.id),
    );
  }, [openRoutineTab, save]);

  const runRoutine = useCallback(
    (id: string) => {
      void runNow(id);
    },
    [runNow],
  );

  return (
    <div className="routines-section">
      <div className="routines-section-header" onClick={toggleCollapsed}>
        <span
          role="button"
          tabIndex={0}
          className="tree-chevron-btn"
          aria-label={collapsed ? "Expand Routines" : "Collapse Routines"}
          aria-expanded={!collapsed}
          onClick={(event) => {
            event.stopPropagation();
            toggleCollapsed();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              toggleCollapsed();
            }
          }}
        >
          <SectionChevron open={!collapsed} />
        </span>
        <span className="routines-section-header-icon" aria-hidden="true">
          <ClockIcon />
        </span>
        <button
          type="button"
          className="routines-section-title-btn"
          onClick={(event) => {
            event.stopPropagation();
            toggleCollapsed();
          }}
        >
          <span className="routines-section-title">Routines</span>
        </button>
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
      {!collapsed && routines.length > 0 ? (
        <ul className="routines-list" role="list">
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              running={runningId === routine.id}
              selected={routine.id === selectedId}
              onOpen={openRoutine}
              onRun={runRoutine}
            />
          ))}
        </ul>
      ) : null}
      {!collapsed && ready && routines.length === 0 ? (
        <p className="routines-empty">No routines yet</p>
      ) : null}
    </div>
  );
});
