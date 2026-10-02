import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConfirmDialog } from "../../components/AppDialog";
import { previewRoutineReport } from "../../lib/dashboardFormat";
import { listRoutineRuns } from "../../lib/routinesApi";
import { readNote } from "../../lib/vaultApi";
import { routineIconColor } from "../../components/routineIcon";
import { useDashboardsLive } from "../../store/dashboardEnabledStore";
import { useRoutinesStore } from "../../store/routinesStore";
import { WidgetRoutineIcon } from "./widgetIcons";

type Report =
  | { phase: "loading" }
  | { phase: "empty" }
  | { phase: "ready"; status: string; text: string; truncated: boolean }
  | { phase: "error"; message: string };

function statusClass(status: string): string {
  if (status === "done") return "is-done";
  if (status === "needs you") return "is-needs-you";
  if (status === "failed") return "is-failed";
  return "is-other";
}

function RunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5.2 3.4v9.2L13 8 5.2 3.4Z" />
    </svg>
  );
}

function RunSpinner() {
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

export const RoutineWidget = memo(function RoutineWidget({
  routineId,
  onRemove,
}: {
  routineId: string;
  onRemove: () => void;
}) {
  const journalEpoch = useRoutinesStore((s) => s.journalEpoch);
  const known = useRoutinesStore((s) => s.epoch > 0);
  const running = useRoutinesStore((s) => s.runningId === routineId);
  const runNow = useRoutinesStore((s) => s.runNow);
  const name = useRoutinesStore(
    (s) => s.routines.find((routine) => routine.id === routineId)?.name ?? null,
  );
  const [report, setReport] = useState<Report>({ phase: "loading" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const sawRunning = useRef(false);
  const live = useDashboardsLive();
  const busy = running || pending;

  useEffect(() => {
    if (!live) return;
    if (!known) return;
    if (!name) return;
    let cancelled = false;
    setReport((current) => (current.phase === "ready" ? current : { phase: "loading" }));
    void (async () => {
      try {
        const runs = await listRoutineRuns(routineId);
        const latest = runs[0];
        if (!latest) {
          if (!cancelled) setReport({ phase: "empty" });
          return;
        }
        const raw = await readNote(latest.path);
        if (cancelled) return;
        const preview = previewRoutineReport(raw);
        setRunError(null);
        setReport({
          phase: "ready",
          status: latest.status,
          text: preview.text,
          truncated: preview.truncated,
        });
      } catch (err) {
        if (cancelled) return;
        setReport({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, known, name, routineId, journalEpoch]);

  useEffect(() => {
    if (!pending) {
      sawRunning.current = false;
      return;
    }
    if (running) {
      sawRunning.current = true;
      return;
    }
    if (sawRunning.current) setPending(false);
  }, [pending, running]);

  return (
    <article className="dashboard-widget">
      <header className="dashboard-widget-handle">
        <span
          className="dashboard-widget-kind"
          style={{ color: routineIconColor(routineId) }}
        >
          <WidgetRoutineIcon />
        </span>
        <span className="dashboard-widget-title">{name ?? "Routine"}</span>
        {live && report.phase === "ready" && report.status ? (
          <span className={`dashboard-widget-status ${statusClass(report.status)}`}>
            {report.status}
          </span>
        ) : null}
        {name ? (
          <button
            type="button"
            className="dashboard-widget-refresh"
            aria-label={busy ? "Routine running" : "Run routine"}
            title={live ? (busy ? "Running" : "Run now") : "Dashboards are off"}
            disabled={!live || busy}
            onClick={(event) => {
              event.stopPropagation();
              if (!live) return;
              setConfirmOpen(true);
            }}
          >
            {busy ? <RunSpinner /> : <RunIcon />}
          </button>
        ) : null}
        <button
          type="button"
          className="dashboard-widget-remove"
          aria-label="Remove widget"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </header>
      <div className="dashboard-widget-body">
        {runError ? <p className="dashboard-widget-empty">{runError}</p> : null}
        {!live ? (
          <p className="dashboard-widget-empty">Paused</p>
        ) : !known || (name && report.phase === "loading") ? (
          <p className="dashboard-widget-empty">Loading…</p>
        ) : !name ? (
          <p className="dashboard-widget-empty">This routine is no longer in the vault.</p>
        ) : report.phase === "empty" ? (
          <p className="dashboard-widget-empty">No runs yet</p>
        ) : report.phase === "error" ? (
          <p className="dashboard-widget-empty">{report.message}</p>
        ) : report.phase === "ready" ? (
          <>
            {report.text ? (
              <div className="dashboard-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.text}</ReactMarkdown>
              </div>
            ) : (
              <p className="dashboard-widget-empty">No report text</p>
            )}
            {report.truncated ? (
              <p className="dashboard-widget-truncated">Report truncated</p>
            ) : null}
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Run now"
        description={`Run “${name ?? "this routine"}” now?`}
        confirmLabel="Run"
        danger={false}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          if (!live) return;
          setRunError(null);
          setPending(true);
          void runNow(routineId).catch((err: unknown) => {
            setPending(false);
            setRunError(err instanceof Error ? err.message : String(err));
          });
        }}
      />
    </article>
  );
});
