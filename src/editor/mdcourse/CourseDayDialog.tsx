import { useEffect, useMemo, useState } from "react";
import { DialogShell } from "../../components/AppDialog";

export type CourseDayRow = {
  name: string;
  question: string;
  when: string;
  time: string;
  color: string;
  times: number;
  /** Logged count, or null if skip. */
  count: number | null;
};

type Props = {
  open: boolean;
  title: string;
  rows: CourseDayRow[];
  onCancel: () => void;
  onSave: (answers: Record<string, number | null>) => void;
};

function clockLabels(time: string, times: number): string[] {
  const parts = time.split(/\s+/).filter(Boolean);
  if (parts.length === times) return parts;
  return [];
}

export function CourseDayDialog({
  open,
  title,
  rows,
  onCancel,
  onSave,
}: Props) {
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, number | null> = {};
    for (const row of rows) next[row.name] = row.count;
    setCounts(next);
  }, [open, title]);

  const answers = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const row of rows) {
      out[row.name.trim().toLowerCase()] = counts[row.name] ?? null;
    }
    return out;
  }, [counts, rows]);

  const setCount = (name: string, value: number | null) => {
    setCounts((cur) => ({ ...cur, [name]: value }));
  };

  const clickSeg = (row: CourseDayRow, seg: number) => {
    const cur = counts[row.name];
    const filled = cur ?? 0;
    const next = seg + 1;
    if (filled === next) setCount(row.name, seg === 0 ? null : seg);
    else setCount(row.name, next);
  };

  return (
    <DialogShell
      open={open}
      title={title}
      description="Mark every segment for this day. Empty stays unmarked."
      wide
      className="course-day-dialog"
      showClose
      onCancel={onCancel}
      footer={
        rows.length === 0 ? (
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Close
          </button>
        ) : (
          <>
            <button
              type="button"
              className="app-dialog-btn"
              onClick={() => {
                const next: Record<string, number | null> = {};
                for (const row of rows) next[row.name] = row.times;
                setCounts(next);
              }}
            >
              All done
            </button>
            <span className="app-dialog-footer-spacer" />
            <button type="button" className="app-dialog-btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="app-dialog-btn is-primary"
              onClick={() => onSave(answers)}
            >
              Save
            </button>
          </>
        )
      }
    >
      <div className="app-dialog-body course-day-body">
        {rows.length === 0 ? (
          <p className="app-dialog-desc">No tracks are active on this day.</p>
        ) : (
          <ul className="course-day-list">
            {rows.map((row) => {
              const k = counts[row.name] ?? null;
              const clocks = clockLabels(row.time, row.times);
              const hint = [row.time && clocks.length === 0 ? row.time : "", row.when]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={row.name} className="course-day-track">
                  <div className="course-day-track-meta">
                    <span
                      className={
                        row.color ? "habit-day-dot" : "habit-day-dot is-none"
                      }
                      style={row.color ? { background: row.color } : undefined}
                      aria-hidden
                    />
                    <div className="course-day-track-text">
                      <div className="course-day-track-name">{row.name}</div>
                      {hint ? (
                        <div className="course-day-track-hint">{hint}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="course-day-controls">
                    <div
                      className="course-day-segs"
                      role="group"
                      aria-label={`${row.name} segments`}
                    >
                      {Array.from({ length: row.times }, (_, seg) => {
                        const on = k != null && k > 0 && seg < k;
                        return (
                          <button
                            key={seg}
                            type="button"
                            className={[
                              "course-day-seg",
                              on ? "is-done" : "",
                              k === 0 ? "is-missed-idle" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            title={clocks[seg] ?? `Time ${seg + 1}`}
                            aria-pressed={on}
                            onClick={() => clickSeg(row, seg)}
                          >
                            {clocks[seg] ?? String(seg + 1)}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className={[
                        "course-day-miss",
                        k === 0 ? "is-on" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={k === 0}
                      onClick={() =>
                        setCount(row.name, k === 0 ? null : 0)
                      }
                    >
                      Miss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DialogShell>
  );
}
