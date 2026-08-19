import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistedEditorScroll } from "../../hooks/usePersistedEditorScroll";
import { createPortal } from "react-dom";
import {
  ConfirmDialog,
  HabitFieldsDialog,
  type HabitFieldsValue,
} from "../../components/AppDialog";
import { HabitDayDialog, type HabitDayRow } from "./HabitDayDialog";
import { DocumentToolbar } from "../../components/DocumentToolbar";
import { CloseIcon, PencilIcon, PlusIcon } from "../../components/treeIcons";
import { useListReorder } from "../../hooks/useListReorder";
import {
  MDHABIT_HEADER,
  applyDayAnswers,
  dayAnswerCounts,
  dayIsLogged,
  habitAnswerOnDay,
  habitDayPaint,
  habitRatioColor,
  localIsoDate,
  parseMdhabit,
  serializeMdhabit,
  type MdhabitDoc,
  type MdhabitItem,
} from "../../lib/mdhabitFormat";

type Props = {
  path: string;
  content: string;
  onChange: (next: string) => void;
};

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function isoDay(year: number, monthIndex: number, day: number): string {
  const m = String(monthIndex + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function mondayPad(year: number, monthIndex: number): number {
  const first = new Date(year, monthIndex, 1);
  return (first.getDay() + 6) % 7;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function formatDayTitle(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function safeParse(content: string): { doc: MdhabitDoc; error: string | null } {
  try {
    return { doc: parseMdhabit(content), error: null };
  } catch (e) {
    return {
      doc: {
        year: new Date().getFullYear(),
        created: localIsoDate(),
        habits: [],
      },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function paintFill(done: number, total: number): string {
  const styles = getComputedStyle(document.documentElement);
  const missed =
    styles.getPropertyValue("--habit-missed").trim() || "#ff4d6d";
  const ok = styles.getPropertyValue("--habit-done").trim() || "#22c55e";
  return habitRatioColor(done, total, missed, ok);
}

const EMPTY_FIELDS: HabitFieldsValue = { name: "", question: "", color: "" };

type CellLook = "none" | "gray" | "ratio" | "done" | "missed";

function cellLook(
  iso: string,
  created: string,
  today: string,
  done: number,
  total: number,
  discrete: boolean,
): CellLook {
  const paint = habitDayPaint(iso, created, today, done, total);
  if (paint !== "ratio") return paint;
  if (!discrete) return "ratio";
  return done > 0 ? "done" : "missed";
}

export function HabitTrackerEditor({ path, content, onChange }: Props) {
  const { doc, error } = useMemo(() => safeParse(content), [content]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [habitDialog, setHabitDialog] = useState<
    { mode: "add" } | { mode: "edit"; index: number } | null
  >(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [dayIso, setDayIso] = useState<string | null>(null);
  const [tip, setTip] = useState<{
    iso: string;
    x: number;
    y: number;
    below: boolean;
  } | null>(null);
  const selectTimer = useRef<number | null>(null);
  const pendingSelectName = useRef<string | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  usePersistedEditorScroll(scrollEl, path, "live");

  useEffect(() => {
    return () => {
      if (selectTimer.current != null) window.clearTimeout(selectTimer.current);
    };
  }, []);

  const emit = useCallback(
    (next: MdhabitDoc) => {
      onChange(serializeMdhabit(next));
    },
    [onChange],
  );

  const selectedIndex = selectedName
    ? doc.habits.findIndex(
        (h) => h.name.toLowerCase() === selectedName.toLowerCase(),
      )
    : -1;
  const selectedHabit = selectedIndex >= 0 ? doc.habits[selectedIndex] : null;
  const deleteHabit = deleteName
    ? (doc.habits.find((h) => h.name === deleteName) ?? null)
    : null;

  const bindReorder = useListReorder(doc.habits.length, (from, to) => {
    if (from === to) return;
    const habits = [...doc.habits];
    const [moved] = habits.splice(from, 1);
    if (!moved) return;
    habits.splice(to, 0, moved);
    emit({ ...doc, habits });
  });

  const today = localIsoDate();
  const discrete = Boolean(selectedHabit);
  const paintHabits = selectedHabit ? [selectedHabit] : doc.habits;

  const dayRows: HabitDayRow[] = useMemo(() => {
    if (!dayIso) return [];
    return doc.habits.map((habit) => ({
      name: habit.name,
      question: habit.question,
      color: habit.color,
      answer: habitAnswerOnDay(habit, dayIso),
    }));
  }, [dayIso, doc.habits]);

  const habitDialogInitial: HabitFieldsValue = useMemo(() => {
    if (habitDialog?.mode === "edit") {
      const h = doc.habits[habitDialog.index];
      if (h) {
        return { name: h.name, question: h.question, color: h.color };
      }
    }
    return EMPTY_FIELDS;
  }, [habitDialog, doc.habits]);

  const tipHabitRows = useMemo(() => {
    if (!tip) return [];
    return doc.habits.map((habit) => ({
      name: habit.name,
      color: habit.color,
      answer: habitAnswerOnDay(habit, tip.iso),
    }));
  }, [tip, doc.habits]);

  if (error) {
    return (
      <div className="habit-tracker-column">
        <DocumentToolbar showOutlineToggle={false} showCommentsToggle={false} />
        <div className="habit-tracker" ref={setScrollEl}>
          <div className="links-editor-error">
            <h2>Invalid habit tracker</h2>
            <p>{error}</p>
            <p className="links-editor-error-hint">
              Switch to Source to fix the file, or recreate it. Expected header:{" "}
              <code>{MDHABIT_HEADER}</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="habit-tracker-column">
      <DocumentToolbar showOutlineToggle={false} showCommentsToggle={false} />
      <div className="habit-tracker" ref={setScrollEl}>
        <div className="habit-tracker-main">
          <h1 className="habit-tracker-year">{doc.year}</h1>
          <div className="habit-tracker-months">
            {MONTHS.map((label, monthIndex) => {
              const pad = mondayPad(doc.year, monthIndex);
              const count = daysInMonth(doc.year, monthIndex);
              const cells: Array<{ iso: string | null }> = [];
              for (let i = 0; i < pad; i++) cells.push({ iso: null });
              for (let day = 1; day <= count; day++) {
                cells.push({ iso: isoDay(doc.year, monthIndex, day) });
              }
              return (
                <section key={label} className="habit-tracker-month">
                  <h2 className="habit-tracker-month-name">{label}</h2>
                  <div className="habit-tracker-weekdays" aria-hidden>
                    {WEEKDAYS.map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <div className="habit-tracker-days">
                    {cells.map((cell, i) => {
                      if (!cell.iso) {
                        return (
                          <span
                            key={`e-${monthIndex}-${i}`}
                            className="habit-tracker-day is-empty"
                          />
                        );
                      }
                      const iso = cell.iso;
                      const { done, answered } = dayAnswerCounts(
                        paintHabits,
                        iso,
                      );
                      const logged = dayIsLogged(doc, iso);
                      const look = cellLook(
                        iso,
                        doc.created,
                        today,
                        done,
                        answered,
                        discrete,
                      );
                      const isToday = iso === today;
                      const style =
                        look === "ratio"
                          ? {
                              background: paintFill(done, answered),
                              color: "#fff",
                            }
                          : undefined;
                      return (
                        <button
                          key={iso}
                          type="button"
                          className={[
                            "habit-tracker-day",
                            isToday ? "is-today" : "",
                            look === "gray" ? "is-gray" : "",
                            look === "ratio" ? "is-painted" : "",
                            look === "done" ? "is-done" : "",
                            look === "missed" ? "is-missed" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          style={style}
                          aria-label={formatDayTitle(iso)}
                          onClick={() => {
                            setTip(null);
                            setDayIso(iso);
                          }}
                          onMouseEnter={(e) => {
                            if (!logged) {
                              setTip(null);
                              return;
                            }
                            const r = e.currentTarget.getBoundingClientRect();
                            const below = r.top < 120;
                            setTip({
                              iso,
                              x: r.left + r.width / 2,
                              y: below ? r.bottom : r.top,
                              below,
                            });
                          }}
                          onMouseLeave={() => setTip(null)}
                        >
                          {Number(iso.slice(8))}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <aside
          className="habit-tracker-aside"
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest(".habit-tracker-habit, .habit-tracker-add-btn")) {
              return;
            }
            if (selectTimer.current != null) {
              window.clearTimeout(selectTimer.current);
              selectTimer.current = null;
              pendingSelectName.current = null;
            }
            setSelectedName(null);
          }}
        >
          <div className="habit-tracker-aside-header">
            <span>Habits</span>
            <button
              type="button"
              className="habit-tracker-add-btn"
              title="Add habit"
              aria-label="Add habit"
              onClick={() => setHabitDialog({ mode: "add" })}
            >
              <PlusIcon />
            </button>
          </div>
          {doc.habits.length === 0 ? (
            <p className="habit-tracker-aside-empty">No habits yet.</p>
          ) : (
            <ul className="habit-tracker-habit-list">
              {doc.habits.map((habit, index) => {
                const bind = bindReorder(index);
                const selected = selectedHabit?.name === habit.name;
                return (
                  <li key={habit.name}>
                    <div
                      className={[
                        "habit-tracker-habit",
                        selected ? "is-selected" : "",
                        bind.className,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      draggable={bind.draggable}
                      onDragStart={bind.onDragStart}
                      onDragEnd={bind.onDragEnd}
                      onDragOver={bind.onDragOver}
                      onDragLeave={bind.onDragLeave}
                      onDrop={bind.onDrop}
                      onClick={() => {
                        if (bind.shouldIgnoreClick()) return;
                        const name = habit.name;
                        if (
                          selectTimer.current != null &&
                          pendingSelectName.current === name
                        ) {
                          window.clearTimeout(selectTimer.current);
                          selectTimer.current = null;
                          pendingSelectName.current = null;
                          return;
                        }
                        if (selectTimer.current != null) {
                          window.clearTimeout(selectTimer.current);
                        }
                        pendingSelectName.current = name;
                        selectTimer.current = window.setTimeout(() => {
                          selectTimer.current = null;
                          pendingSelectName.current = null;
                          setSelectedName((cur) =>
                            cur === name ? null : name,
                          );
                        }, 220);
                      }}
                      onDoubleClick={() => {
                        if (bind.shouldIgnoreClick()) return;
                        if (selectTimer.current != null) {
                          window.clearTimeout(selectTimer.current);
                          selectTimer.current = null;
                        }
                        pendingSelectName.current = null;
                        setSelectedName(habit.name);
                        setHabitDialog({ mode: "edit", index });
                      }}
                    >
                      <span
                        className={
                          habit.color
                            ? "habit-tracker-habit-dot"
                            : "habit-tracker-habit-dot is-none"
                        }
                        style={
                          habit.color ? { background: habit.color } : undefined
                        }
                        aria-hidden
                      />
                      <span className="habit-tracker-habit-name">
                        {habit.name}
                      </span>
                      <button
                        type="button"
                        className="habit-tracker-habit-action"
                        title={`Edit ${habit.name}`}
                        aria-label={`Edit ${habit.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selectTimer.current != null) {
                            window.clearTimeout(selectTimer.current);
                            selectTimer.current = null;
                          }
                          pendingSelectName.current = null;
                          setSelectedName(habit.name);
                          setHabitDialog({ mode: "edit", index });
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <PencilIcon size={12} />
                      </button>
                      <button
                        type="button"
                        className="habit-tracker-habit-action is-danger"
                        title={`Delete ${habit.name}`}
                        aria-label={`Delete ${habit.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteName(habit.name);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>

      <HabitFieldsDialog
        open={habitDialog !== null}
        mode={habitDialog?.mode === "edit" ? "edit" : "add"}
        initial={habitDialogInitial}
        existingNames={doc.habits.map((h) => h.name)}
        onCancel={() => setHabitDialog(null)}
        onConfirm={(value) => {
          const habits = [...doc.habits];
          if (habitDialog?.mode === "edit") {
            const cur = habits[habitDialog.index];
            if (!cur) {
              setHabitDialog(null);
              return;
            }
            habits[habitDialog.index] = {
              ...cur,
              name: value.name,
              question: value.question,
              color: value.color,
            };
            setSelectedName(value.name);
          } else {
            const item: MdhabitItem = {
              name: value.name,
              question: value.question,
              color: value.color,
              dates: [],
              no: [],
            };
            habits.push(item);
          }
          emit({ ...doc, habits });
          setHabitDialog(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteHabit)}
        title="Delete habit"
        description={
          deleteHabit
            ? `Delete “${deleteHabit.name}” and all of its logged days? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setDeleteName(null)}
        onConfirm={() => {
          if (!deleteHabit) return;
          emit({
            ...doc,
            habits: doc.habits.filter((h) => h.name !== deleteHabit.name),
          });
          if (selectedName === deleteHabit.name) setSelectedName(null);
          setDeleteName(null);
        }}
      />

      <HabitDayDialog
        open={dayIso !== null}
        title={dayIso ? formatDayTitle(dayIso) : "Day"}
        rows={dayRows}
        onCancel={() => setDayIso(null)}
        onSave={(yesNames, noNames) => {
          if (!dayIso) return;
          emit({
            ...doc,
            habits: applyDayAnswers(doc.habits, dayIso, yesNames, noNames),
          });
        }}
        onDone={() => setDayIso(null)}
      />

      {tip
        ? createPortal(
            <div
              className={[
                "habit-day-tooltip",
                tip.below ? "is-below" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="tooltip"
              style={{ left: tip.x, top: tip.y }}
            >
              <div className="habit-day-tooltip-title">
                {formatDayTitle(tip.iso)}
              </div>
              <ul className="habit-day-tooltip-list">
                {tipHabitRows.map((row) => {
                  const label =
                    row.answer === "yes"
                      ? "Yes"
                      : row.answer === "no"
                        ? "No"
                        : "Skipped";
                  return (
                    <li key={row.name}>
                      <span
                        className={
                          row.color
                            ? "habit-day-dot"
                            : "habit-day-dot is-none"
                        }
                        style={
                          row.color ? { background: row.color } : undefined
                        }
                        aria-hidden
                      />
                      <span className="habit-day-tooltip-name">{row.name}</span>
                      <span
                        className={[
                          "habit-day-tooltip-status",
                          row.answer === "yes"
                            ? "is-done"
                            : row.answer === "no"
                              ? "is-missed"
                              : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
