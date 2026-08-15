import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { HabitAnswer } from "../../lib/mdhabitFormat";

export type HabitDayRow = {
  name: string;
  question: string;
  color: string;
  answer: HabitAnswer;
};

type Props = {
  open: boolean;
  title: string;
  rows: HabitDayRow[];
  onCancel: () => void;
  onSave: (yesNames: string[], noNames: string[]) => void;
  onDone: () => void;
};

function answersFromTouched(
  checked: Record<string, boolean>,
  touched: Record<string, boolean>,
): { yes: string[]; no: string[] } {
  const yes: string[] = [];
  const no: string[] = [];
  for (const [name, was] of Object.entries(touched)) {
    if (!was) continue;
    if (checked[name]) yes.push(name);
    else no.push(name);
  }
  return { yes, no };
}

export function HabitDayDialog({
  open,
  title,
  rows,
  onCancel,
  onSave,
  onDone,
}: Props) {
  const titleId = useId();
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<"idle" | "correct" | "wrong">("idle");
  const busyRef = useRef(false);
  const advanceTimer = useRef<number | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const clearAdvance = () => {
    if (advanceTimer.current != null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    busyRef.current = false;
  };

  useEffect(() => {
    if (!open) {
      clearAdvance();
      setFlash("idle");
      setIndex(0);
      return;
    }
    const next: Record<string, boolean> = {};
    const nextTouched: Record<string, boolean> = {};
    for (const row of rowsRef.current) {
      if (row.answer === "none") continue;
      next[row.name] = row.answer === "yes";
      nextTouched[row.name] = true;
    }
    setChecked(next);
    setTouched(nextTouched);
    setIndex(0);
    setFlash("idle");
    busyRef.current = false;
  }, [open, title]);

  useEffect(() => {
    return () => clearAdvance();
  }, []);

  const answer = useCallback(
    (done: boolean) => {
      const row = rows[index];
      if (!row || busyRef.current || flash !== "idle") return;
      busyRef.current = true;
      const nextChecked = { ...checked, [row.name]: done };
      const nextTouched = { ...touched, [row.name]: true };
      setChecked(nextChecked);
      setTouched(nextTouched);
      setFlash(done ? "correct" : "wrong");
      advanceTimer.current = window.setTimeout(() => {
        advanceTimer.current = null;
        busyRef.current = false;
        setFlash("idle");
        const { yes, no } = answersFromTouched(nextChecked, nextTouched);
        onSave(yes, no);
        if (index + 1 >= rows.length) {
          onDone();
          return;
        }
        setIndex((i) => i + 1);
      }, 320);
    },
    [checked, flash, index, onDone, onSave, rows, touched],
  );

  const goBack = useCallback(() => {
    if (busyRef.current || index <= 0) return;
    clearAdvance();
    setFlash("idle");
    setIndex((i) => i - 1);
  }, [index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.isComposing) return;
      if (rows.length === 0) return;
      if (e.key === "Backspace" || e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
        return;
      }
      if (flash !== "idle") return;
      if (e.key === "y" || e.key === "Y" || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        answer(true);
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        answer(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [answer, flash, goBack, onCancel, open, rows.length]);

  if (!open) return null;

  const row = rows[index] ?? null;
  const stageClass =
    flash === "correct"
      ? "dict-practice habit-check is-correct"
      : flash === "wrong"
        ? "dict-practice habit-check is-wrong"
        : "dict-practice habit-check";

  return createPortal(
    <div className="dict-practice-root" role="presentation">
      <button
        type="button"
        className="dict-practice-backdrop"
        aria-label="Close"
        onClick={onCancel}
      />
      <div
        className={stageClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          type="button"
          className="dict-practice-exit"
          onClick={onCancel}
          aria-label="Close"
        >
          Esc
        </button>

        {rows.length === 0 || !row ? (
          <div className="dict-practice-empty">
            <p className="dict-practice-status" id={titleId}>
              Add a habit first, then you can log this day.
            </p>
            <button
              type="button"
              className="dict-practice-primary"
              onClick={onCancel}
            >
              Back
            </button>
          </div>
        ) : (
          <>
            <div className="dict-practice-top">
              <div
                className="dict-practice-pips"
                aria-label={`${index + 1} of ${rows.length}`}
              >
                {rows.map((item, i) => {
                  const done = Boolean(checked[item.name]);
                  const missed = Boolean(touched[item.name]) && !done;
                  const current = i === index;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      className={[
                        "dict-practice-pip habit-check-pip",
                        done ? "is-done" : "",
                        missed ? "is-missed" : "",
                        current ? "is-current" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      title={item.name}
                      aria-label={item.name}
                      disabled={flash !== "idle"}
                      onClick={() => {
                        if (flash !== "idle") return;
                        clearAdvance();
                        setFlash("idle");
                        setIndex(i);
                      }}
                    />
                  );
                })}
              </div>
              <span className="dict-practice-count">
                {index + 1}/{rows.length}
              </span>
            </div>

            <p className="habit-check-date" id={titleId}>
              {title}
            </p>

            <div className="habit-check-chip">
              <span
                className={
                  row.color ? "habit-day-dot" : "habit-day-dot is-none"
                }
                style={row.color ? { background: row.color } : undefined}
                aria-hidden
              />
              <span>{row.name}</span>
            </div>

            <p className="dict-practice-prompt">{row.question}</p>

            <div className="habit-check-choices">
              <button
                type="button"
                className={[
                  "habit-check-choice is-yes",
                  checked[row.name] ? "is-picked" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={flash !== "idle"}
                onClick={() => answer(true)}
              >
                Yes
              </button>
              <button
                type="button"
                className={[
                  "habit-check-choice is-no",
                  checked[row.name] === false && touched[row.name]
                    ? "is-picked"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={flash !== "idle"}
                onClick={() => answer(false)}
              >
                No
              </button>
            </div>

            <div className="dict-practice-skip">
              {index > 0 ? (
                <button
                  type="button"
                  className="dict-practice-ghost"
                  disabled={flash !== "idle"}
                  onClick={goBack}
                >
                  ← Back
                </button>
              ) : (
                <span className="habit-check-hint">Y / N · Enter</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
