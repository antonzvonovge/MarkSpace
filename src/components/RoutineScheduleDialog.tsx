import { useState } from "react";
import {
  SCHEDULE_PRESETS,
  cronToSchedule,
  endTimeInputValue,
  scheduleIssue,
  scheduleToCron,
  timeInputValue,
  type RoutineSchedule,
} from "../lib/routineSchedule";
import { DialogShell } from "./AppDialog";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function draftFromCron(cron: string): RoutineSchedule {
  return (
    cronToSchedule(cron) ?? {
      frequency: "daily",
      hour: 9,
      minute: 0,
      endHour: 23,
      endMinute: 59,
      days: [],
    }
  );
}

export function RoutineScheduleDialog({
  cron,
  onCancel,
  onConfirm,
}: {
  cron: string;
  onCancel: () => void;
  onConfirm: (cron: string) => void;
}) {
  const [draft, setDraft] = useState(() => draftFromCron(cron));
  const unparsed = cronToSchedule(cron) == null && cron.trim().length > 0;

  const setTime = (value: string) => {
    const [hourRaw, minuteRaw] = value.split(":");
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return;
    setDraft((current) => ({ ...current, hour, minute }));
  };

  const setEndTime = (value: string) => {
    const [hourRaw, minuteRaw] = value.split(":");
    const endHour = Number(hourRaw);
    const endMinute = Number(minuteRaw);
    if (!Number.isInteger(endHour) || !Number.isInteger(endMinute)) return;
    setDraft((current) => ({ ...current, endHour, endMinute }));
  };

  const toggleDay = (day: number) => {
    setDraft((current) => {
      if (current.frequency === "hourly") {
        const base = current.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : current.days;
        const days = base.includes(day)
          ? base.filter((item) => item !== day)
          : [...base, day].sort((a, b) => a - b);
        if (days.length === 0) return current;
        return { ...current, days: days.length === 7 ? [] : days };
      }
      const has = current.days.includes(day);
      const days = has
        ? current.days.filter((item) => item !== day)
        : [...current.days, day].sort((a, b) => a - b);
      return { ...current, days };
    });
  };

  const issue = scheduleIssue(draft);
  const hourlyDayOn = (day: number) => draft.days.length === 0 || draft.days.includes(day);

  return (
    <DialogShell
      open
      nested
      title="Schedule"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={issue != null}
            onClick={() => onConfirm(scheduleToCron(draft))}
          >
            OK
          </button>
        </>
      }
    >
      <div className="app-dialog-body">
        <div className="routines-presets">
          {SCHEDULE_PRESETS.map((preset) => (
            <button
              key={preset.cron}
              type="button"
              className={
                scheduleToCron(draft) === preset.cron ||
                (preset.cron === "0 9 * * 1-5" &&
                  scheduleToCron(draft) === "0 9 * * 1,2,3,4,5")
                  ? "routines-preset is-selected"
                  : "routines-preset"
              }
              onClick={() => {
                const next = cronToSchedule(preset.cron);
                if (next) setDraft(next);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {unparsed ? (
          <p className="app-dialog-hint">
            Current cron {cron.trim()} is replaced when you save this schedule.
          </p>
        ) : null}
        <div className="app-dialog-label">Repeat</div>
        <div className="routines-frequency" role="radiogroup" aria-label="Repeat">
          {(
            [
              ["daily", "Daily"],
              ["weekly", "Weekly"],
              ["hourly", "Hourly"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={draft.frequency === id}
              className={
                draft.frequency === id
                  ? "routines-frequency-btn is-selected"
                  : "routines-frequency-btn"
              }
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  frequency: id,
                  days:
                    id === "weekly" && current.days.length === 0
                      ? [1, 2, 3, 4, 5]
                      : current.days,
                }))
              }
            >
              {label}
            </button>
          ))}
        </div>
        {draft.frequency === "hourly" ? (
          <div className="routines-window">
            <label className="routines-window-field" htmlFor="routine-start">
              <span className="app-dialog-label">Start</span>
              <input
                id="routine-start"
                className="app-dialog-input routines-time"
                type="time"
                value={timeInputValue(draft)}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
            <label className="routines-window-field" htmlFor="routine-end">
              <span className="app-dialog-label">End</span>
              <input
                id="routine-end"
                className="app-dialog-input routines-time"
                type="time"
                value={endTimeInputValue(draft)}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
          </div>
        ) : (
          <>
            <label className="app-dialog-label" htmlFor="routine-time">
              Start
            </label>
            <input
              id="routine-time"
              className="app-dialog-input routines-time"
              type="time"
              value={timeInputValue(draft)}
              onChange={(event) => setTime(event.target.value)}
            />
          </>
        )}
        {issue ? <p className="app-dialog-hint">{issue}</p> : null}
        {draft.frequency === "daily" ? null : (
          <>
            <div className="app-dialog-label">Days</div>
            <div className="routines-days">
              {DAY_LABELS.map((label, day) => {
                const on =
                  draft.frequency === "hourly" ? hourlyDayOn(day) : draft.days.includes(day);
                return (
                  <button
                    key={DAY_NAMES[day]}
                    type="button"
                    className={on ? "routines-day is-selected" : "routines-day"}
                    aria-pressed={on}
                    aria-label={DAY_NAMES[day]}
                    onClick={() => toggleDay(day)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </DialogShell>
  );
}
