import { memo, useEffect, useRef, useState } from "react";
import { formatSchedule } from "../lib/routineSchedule";
import {
  deleteRoutineRun,
  listRoutineRuns,
  type RoutineRunFile,
  type RoutineTrigger,
} from "../lib/routinesApi";
import { useRoutinesStore } from "../store/routinesStore";
import { routineIdFromTab, useVaultStore } from "../store/vaultStore";
import { ConfirmDialog } from "./AppDialog";
import { RoutineScheduleDialog } from "./RoutineScheduleDialog";

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error && err.message) return err.message;
  return "Could not save routine";
}

function formatNextFire(iso: string | null | undefined): string {
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

function triggerLabel(trigger: RoutineTrigger): string {
  if (trigger === "manual") return "Manual";
  if (trigger === "catchup") return "Catch-up";
  return "Scheduled";
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5.2 3.4v9.2L13 8 5.2 3.4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.25 4.25h9.5M6.25 4.25V3.2c0-.4.3-.7.7-.7h2.1c.4 0 .7.3.7.7v1.05M4.5 4.25l.55 8.05c.04.5.46.9.96.9h4c.5 0 .92-.4.96-.9l.53-8.05"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function JobSpinner() {
  return (
    <span className="routines-spinner" aria-hidden="true">
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

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.25 8A5.25 5.25 0 0 1 4.4 11.6M2.75 8A5.25 5.25 0 0 1 11.6 4.4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M13.25 3.1v2.7h-2.7M2.75 12.9V10.2h2.7"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="12.5" cy="8" r="1.15" />
    </svg>
  );
}

export const RoutineDocumentTab = memo(function RoutineDocumentTab({
  path,
  isActive,
}: {
  path: string;
  isActive: boolean;
}) {
  const id = routineIdFromTab(path);
  return (
    <div
      className={isActive ? "document-instance is-active" : "document-instance"}
      aria-hidden={!isActive}
      inert={!isActive}
    >
      {isActive && id ? <RoutineJob id={id} /> : null}
    </div>
  );
});

function RoutineJob({ id }: { id: string }) {
  const routine = useRoutinesStore((s) => s.routines.find((item) => item.id === id));
  const epoch = useRoutinesStore((s) => s.epoch);
  const runningId = useRoutinesStore((s) => s.runningId);
  const journalEpoch = useRoutinesStore((s) => s.journalEpoch);
  const save = useRoutinesStore((s) => s.save);
  const remove = useRoutinesStore((s) => s.remove);
  const runNow = useRoutinesStore((s) => s.runNow);
  const setEnabledFlag = useRoutinesStore((s) => s.setEnabled);
  const openNote = useVaultStore((s) => s.openNote);
  const [name, setName] = useState(routine?.name ?? "");
  const [cron, setCron] = useState(routine?.cron ?? "0 9 * * *");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [runs, setRuns] = useState<RoutineRunFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"run" | "delete" | null>(null);
  const [deleteRun, setDeleteRun] = useState<RoutineRunFile | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [holdRun, setHoldRun] = useState(false);
  const nameFocused = useRef(false);
  const listSeq = useRef(0);
  const holdEpoch = useRef<number | null>(null);

  useEffect(() => {
    if (!routine || nameFocused.current) return;
    setName(routine.name);
    setCron(routine.cron);
  }, [routine]);

  useEffect(() => {
    const seq = ++listSeq.current;
    void listRoutineRuns(id)
      .then((rows) => {
        if (seq !== listSeq.current) return;
        setRuns(rows);
        const state = useRoutinesStore.getState();
        if (
          holdEpoch.current != null &&
          state.journalEpoch !== holdEpoch.current &&
          state.runningId !== id
        ) {
          holdEpoch.current = null;
          setHoldRun(false);
        }
      })
      .catch((err: unknown) => {
        if (seq !== listSeq.current) return;
        if (holdEpoch.current != null) {
          holdEpoch.current = null;
          setHoldRun(false);
        }
        setError(errorText(err));
      });
  }, [id, journalEpoch, reloadTick]);

  const persist = async (nextName: string, nextCron: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) {
      setName(routine?.name ?? "");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save({ id, name: trimmed, cron: nextCron });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!routine) {
    if (epoch === 0) return null;
    return <p className="routine-job-missing">This routine is no longer in the vault.</p>;
  }

  const running = runningId === id || holdRun;
  const nextFire = formatNextFire(routine.nextRunAt);

  return (
    <div className="routine-job">
      <div className="routine-job-toolbar">
        {running ? (
          <span className="routine-job-status" role="status">
            <JobSpinner />
            Running
          </span>
        ) : null}
        <label className="routine-job-enabled">
          <input
            className="routine-job-enabled-box"
            type="checkbox"
            checked={routine.enabled}
            onChange={(event) => {
              const next = event.target.checked;
              void setEnabledFlag(id, next).catch((err: unknown) => setError(errorText(err)));
            }}
          />
          Enabled
        </label>
        <button
          type="button"
          className="routine-job-icon-btn"
          title="Run now"
          aria-label={`Run ${routine.name} now`}
          disabled={running}
          onClick={() => setConfirm("run")}
        >
          <PlayIcon />
        </button>
        <button
          type="button"
          className="routine-job-icon-btn"
          title="Delete"
          aria-label={`Delete ${routine.name}`}
          disabled={busy}
          onClick={() => setConfirm("delete")}
        >
          <TrashIcon />
        </button>
      </div>
      <div className="routine-job-settings">
        <label className="routine-job-label" htmlFor={`routine-name-${id}`}>
          Name
        </label>
        <input
          id={`routine-name-${id}`}
          className="routine-job-input"
          value={name}
          disabled={busy}
          onFocus={() => {
            nameFocused.current = true;
          }}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            nameFocused.current = false;
            if (name.trim() !== routine.name) void persist(name, cron);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <div className="routine-job-label">Schedule</div>
        <div className="routines-schedule-field">
          <span className="routines-schedule-summary">{formatSchedule(cron)}</span>
          <button
            type="button"
            className="routines-schedule-more"
            aria-label="Edit schedule"
            title="Edit schedule"
            onClick={() => setScheduleOpen(true)}
          >
            <MoreIcon />
          </button>
        </div>
        {error ? <p className="routine-job-error">{error}</p> : null}
      </div>
      <div className="routine-job-label routine-job-runs-label">
        <span>
          Runs
          {nextFire ? <span className="routine-job-next"> (next run {nextFire})</span> : null}
        </span>
        <button
          type="button"
          className="routine-job-refresh"
          title="Refresh runs"
          aria-label="Refresh runs"
          onClick={() => setReloadTick((tick) => tick + 1)}
        >
          <RefreshIcon />
        </button>
      </div>
      {runs.length === 0 ? (
        <p className="routine-job-empty">No runs yet</p>
      ) : (
        <ul className="routine-job-runs">
          {runs.map((run) => (
            <li key={run.path} className="routine-job-run-line">
              <button
                type="button"
                className="routine-job-run"
                onClick={() => {
                  void openNote(run.path, { preview: false, syncTreeSelection: false });
                }}
              >
                <span className="routine-job-run-when">{run.at}</span>
                <span className="routine-job-run-trigger">{triggerLabel(run.trigger)}</span>
              </button>
              <button
                type="button"
                className="routine-job-run-delete"
                title="Delete run"
                aria-label={`Delete run ${run.at}`}
                onClick={() => setDeleteRun(run)}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleteRun !== null}
        title="Delete run"
        description={
          deleteRun
            ? `Delete the run from ${deleteRun.at}? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setDeleteRun(null)}
        onConfirm={() => {
          const run = deleteRun;
          setDeleteRun(null);
          if (!run) return;
          listSeq.current += 1;
          setRuns((rows) => rows.filter((row) => row.path !== run.path));
          const { tabs, closeTab } = useVaultStore.getState();
          if (tabs.some((tab) => tab.path === run.path)) {
            void closeTab(run.path);
          }
          void deleteRoutineRun(id, run.path).catch((err: unknown) => {
            setError(errorText(err));
            const seq = ++listSeq.current;
            void listRoutineRuns(id).then((rows) => {
              if (seq === listSeq.current) setRuns(rows);
            });
          });
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "delete" ? "Delete routine" : "Run now"}
        description={
          confirm === "delete"
            ? `Delete “${routine.name}” and its run history? This cannot be undone.`
            : `Run “${routine.name}” now?`
        }
        confirmLabel={confirm === "delete" ? "Delete" : "Run"}
        danger={confirm === "delete"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action === "delete") {
            void remove(id).catch((err: unknown) => setError(errorText(err)));
            return;
          }
          if (action === "run") {
            holdEpoch.current = useRoutinesStore.getState().journalEpoch;
            setHoldRun(true);
            void runNow(id).catch((err: unknown) => {
              holdEpoch.current = null;
              setHoldRun(false);
              setError(errorText(err));
            });
          }
        }}
      />
      {scheduleOpen ? (
        <RoutineScheduleDialog
          cron={cron}
          onCancel={() => setScheduleOpen(false)}
          onConfirm={(next) => {
            setCron(next);
            setScheduleOpen(false);
            void persist(name, next);
          }}
        />
      ) : null}
    </div>
  );
}
