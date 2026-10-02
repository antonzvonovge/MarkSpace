import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { previewRoutineReport } from "../../lib/dashboardFormat";
import { listRoutineRuns } from "../../lib/routinesApi";
import { readNote } from "../../lib/vaultApi";
import { useRoutinesStore } from "../../store/routinesStore";

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

export const RoutineWidget = memo(function RoutineWidget({
  routineId,
  onRemove,
}: {
  routineId: string;
  onRemove: () => void;
}) {
  const journalEpoch = useRoutinesStore((s) => s.journalEpoch);
  const known = useRoutinesStore((s) => s.epoch > 0);
  const name = useRoutinesStore(
    (s) => s.routines.find((routine) => routine.id === routineId)?.name ?? null,
  );
  const [report, setReport] = useState<Report>({ phase: "loading" });

  useEffect(() => {
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
  }, [known, name, routineId, journalEpoch]);

  return (
    <article className="dashboard-widget">
      <header className="dashboard-widget-handle">
        <span className="dashboard-widget-title">{name ?? "Routine"}</span>
        {report.phase === "ready" && report.status ? (
          <span className={`dashboard-widget-status ${statusClass(report.status)}`}>
            {report.status}
          </span>
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
        {!known || (name && report.phase === "loading") ? (
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
    </article>
  );
});
