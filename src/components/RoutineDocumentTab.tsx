import { memo, useEffect, useRef, useState } from "react";
import { WIDGET_SECTION_EXAMPLE } from "../ai/routineWidgetSection";
import { formatSchedule } from "../lib/routineSchedule";
import {
  briefStateFromRoutine,
  type RoutineBriefState,
} from "../lib/routineBrief";
import {
  deleteRoutineRun,
  listRoutineRuns,
  routineIsCommand,
  type RoutineRunFile,
  type RoutineTrigger,
} from "../lib/routinesApi";
import { useRoutinesStore } from "../store/routinesStore";
import { routineIdFromTab, useVaultStore } from "../store/vaultStore";
import { ConfirmDialog } from "./AppDialog";
import { RoutineBriefComposer } from "./RoutineBriefComposer";
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

function statusLabel(status: string): string {
  if (status === "needs you") return "Needs you";
  if (status === "failed") return "Failed";
  if (status === "ok" || status === "done" || !status) return "Done";
  return status;
}

const COMMAND_TIMEOUT_MAX_SEC = 600;
const COMMAND_TIMEOUT_DEFAULT_SEC = 60;

function timeoutSeconds(ms: number | undefined): number {
  if (!ms) return COMMAND_TIMEOUT_DEFAULT_SEC;
  return Math.min(COMMAND_TIMEOUT_MAX_SEC, Math.max(1, Math.round(ms / 1000)));
}

const COMMAND_HINT =
  "The dashboard card shows the last closed block from stdout. Otherwise it shows stdout. The command runs unattended when this routine fires.";

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
  const [kind, setKind] = useState(routine?.kind === "command" ? "command" : "");
  const [command, setCommand] = useState(routine?.command ?? "");
  const [commandCwd, setCommandCwd] = useState(routine?.commandCwd ?? "");
  const [timeoutSec, setTimeoutSec] = useState(() =>
    String(timeoutSeconds(routine?.commandTimeoutMs)),
  );
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [runs, setRuns] = useState<RoutineRunFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"run" | "delete" | null>(null);
  const [deleteRun, setDeleteRun] = useState<RoutineRunFile | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [holdRun, setHoldRun] = useState(false);
  const nameFocused = useRef(false);
  const commandFocused = useRef(false);
  const cwdFocused = useRef(false);
  const timeoutFocused = useRef(false);
  const listSeq = useRef(0);
  const holdEpoch = useRef<number | null>(null);
  const nameRef = useRef(name);
  const cronRef = useRef(cron);
  const kindRef = useRef(kind);
  const commandRef = useRef(command);
  const cwdRef = useRef(commandCwd);
  const timeoutMsRef = useRef(timeoutSeconds(routine?.commandTimeoutMs) * 1000);
  const briefRef = useRef<RoutineBriefState | null>(routine ? briefStateFromRoutine(routine) : null);
  const saveQueue = useRef(Promise.resolve());
  const saveTimer = useRef<number | null>(null);
  nameRef.current = name;
  cronRef.current = cron;
  kindRef.current = kind;
  commandRef.current = command;
  cwdRef.current = commandCwd;

  useEffect(() => {
    if (!routine) return;
    if (!nameFocused.current) {
      setName(routine.name);
      setCron(routine.cron);
    }
    if (!commandFocused.current && !cwdFocused.current && !timeoutFocused.current) {
      const nextKind = routine.kind === "command" ? "command" : "";
      setKind(nextKind);
      kindRef.current = nextKind;
    }
    if (!commandFocused.current) {
      setCommand(routine.command ?? "");
      commandRef.current = routine.command ?? "";
    }
    if (!cwdFocused.current) {
      setCommandCwd(routine.commandCwd ?? "");
      cwdRef.current = routine.commandCwd ?? "";
    }
    if (!timeoutFocused.current) {
      const seconds = timeoutSeconds(routine.commandTimeoutMs);
      setTimeoutSec(String(seconds));
      timeoutMsRef.current = seconds * 1000;
    }
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

  const persistAll = (nextName?: string, nextCron?: string) => {
    const trimmed = (nextName ?? nameRef.current).trim();
    if (!trimmed) {
      setName(routine?.name ?? "");
      nameRef.current = routine?.name ?? "";
      return;
    }
    nameRef.current = trimmed;
    cronRef.current = nextCron ?? cronRef.current;
    const brief = briefRef.current;
    const run = saveQueue.current.then(async () => {
      setBusy(true);
      setError(null);
      try {
        await save({
          id,
          name: nameRef.current.trim(),
          cron: cronRef.current,
          brief: brief?.brief ?? null,
          projectPath: brief?.projectPath ?? null,
          mode: brief?.mode ?? null,
          modelId: brief?.modelId ?? null,
          reasoningMode: brief?.reasoningMode ?? null,
          specialistModelId: brief?.specialistModelId ?? null,
          specialistsUseChatModel: brief?.specialistsUseChatModel ?? null,
          attachments: brief?.attachments ?? null,
          kind: kindRef.current,
          command: commandRef.current,
          commandCwd: cwdRef.current,
          commandTimeoutMs: timeoutMsRef.current,
        });
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(false);
      }
    });
    saveQueue.current = run.then(
      () => undefined,
      () => undefined,
    );
  };

  const scheduleBriefSave = () => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      persistAll();
    }, 400);
  };

  const chooseKind = (next: "agent" | "command") => {
    const stored = next === "command" ? "command" : "";
    kindRef.current = stored;
    setKind(stored);
    persistAll();
  };

  const commandMode = routineIsCommand(kind);

  useEffect(() => {
    return () => {
      if (saveTimer.current != null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        persistAll();
      }
    };
  }, []);

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
        <div className="routine-job-meta">
          <div className="routine-job-field">
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
                if (name.trim() !== routine.name) persistAll(name, cron);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
          <div className="routine-job-field">
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
          </div>
        </div>
        <div className="routine-job-field">
          <div className="routine-job-label">Runs as</div>
          <div className="routine-job-kind">
            <button
              type="button"
              className={commandMode ? "routines-preset" : "routines-preset is-selected"}
              onClick={() => chooseKind("agent")}
            >
              Agent
            </button>
            <button
              type="button"
              className={commandMode ? "routines-preset is-selected" : "routines-preset"}
              onClick={() => chooseKind("command")}
            >
              Command
            </button>
          </div>
        </div>
        {commandMode ? (
          <>
            <div className="routine-job-label">Command</div>
            <div className="routine-job-widget-hint">
              <p>{COMMAND_HINT}</p>
              <pre>
                <code>{WIDGET_SECTION_EXAMPLE}</code>
              </pre>
            </div>
            <textarea
              className="routine-job-command"
              aria-label="Routine command"
              spellCheck={false}
              value={command}
              onFocus={() => {
                commandFocused.current = true;
              }}
              onBlur={() => {
                commandFocused.current = false;
              }}
              onChange={(event) => {
                const next = event.target.value;
                commandRef.current = next;
                setCommand(next);
                scheduleBriefSave();
              }}
            />
            <div className="routine-job-meta">
              <div className="routine-job-field">
                <label className="routine-job-label" htmlFor={`routine-cwd-${id}`}>
                  Working directory
                </label>
                <input
                  id={`routine-cwd-${id}`}
                  className="routine-job-input"
                  placeholder="Vault root"
                  value={commandCwd}
                  onFocus={() => {
                    cwdFocused.current = true;
                  }}
                  onBlur={() => {
                    cwdFocused.current = false;
                  }}
                  onChange={(event) => {
                    const next = event.target.value;
                    cwdRef.current = next;
                    setCommandCwd(next);
                    scheduleBriefSave();
                  }}
                />
              </div>
              <div className="routine-job-field routine-job-timeout">
                <label className="routine-job-label" htmlFor={`routine-timeout-${id}`}>
                  Timeout (seconds)
                </label>
                <input
                  id={`routine-timeout-${id}`}
                  className="routine-job-input"
                  inputMode="numeric"
                  value={timeoutSec}
                  onFocus={() => {
                    timeoutFocused.current = true;
                  }}
                  onBlur={() => {
                    timeoutFocused.current = false;
                    const sec = Number(timeoutSec);
                    const next = Number.isInteger(sec)
                      ? Math.min(COMMAND_TIMEOUT_MAX_SEC, Math.max(1, sec))
                      : timeoutSeconds(timeoutMsRef.current);
                    timeoutMsRef.current = next * 1000;
                    setTimeoutSec(String(next));
                    persistAll();
                  }}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTimeoutSec(next);
                    const sec = Number(next);
                    if (!Number.isInteger(sec)) return;
                    const clamped = Math.min(COMMAND_TIMEOUT_MAX_SEC, Math.max(1, sec));
                    timeoutMsRef.current = clamped * 1000;
                    scheduleBriefSave();
                  }}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="routine-job-label">Brief</div>
            <div className="routine-job-brief">
              <RoutineBriefComposer
                key={id}
                folder={routine.folder}
                initial={briefStateFromRoutine(routine)}
                onChange={(next) => {
                  briefRef.current = next;
                  scheduleBriefSave();
                }}
              />
            </div>
          </>
        )}
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
                <span className="routine-job-run-trigger">
                  {statusLabel(run.status)} · {triggerLabel(run.trigger)}
                </span>
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
            if (saveTimer.current != null) {
              window.clearTimeout(saveTimer.current);
              saveTimer.current = null;
            }
            persistAll();
            holdEpoch.current = useRoutinesStore.getState().journalEpoch;
            setHoldRun(true);
            void saveQueue.current
              .then(() => runNow(id))
              .catch((err: unknown) => {
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
            cronRef.current = next;
            setScheduleOpen(false);
            persistAll(name, next);
          }}
        />
      ) : null}
    </div>
  );
}
