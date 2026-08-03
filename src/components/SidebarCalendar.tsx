import { useMemo, useState } from "react";
import {
  collectDailyNoteDayKeys,
  dayKey,
  parseDailyNoteDate,
  resolveDiaryProjectRoot,
} from "../lib/diaryNotes";
import { useChatStore } from "../store/chatStore";
import { useVaultStore } from "../store/vaultStore";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Monday-based weekday index: Mon=0 … Sun=6 */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function buildMonthCells(viewMonth: Date): Date[] {
  const first = startOfMonth(viewMonth);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayIndex(first));

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.75 3.5 5.25 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.25 3.5 10.75 8l-4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CalendarCheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M3.25 3.25h9.5A1.25 1.25 0 0 1 14 4.5v8.25A1.25 1.25 0 0 1 12.75 14H3.25A1.25 1.25 0 0 1 2 12.75V4.5A1.25 1.25 0 0 1 3.25 3.25Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M2 6.25h12M5 2.25v2.25M11 2.25v2.25"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 10.1 7.15 11.6 10.6 8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarCalendar() {
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const cells = useMemo(() => buildMonthCells(viewMonth), [viewMonth]);
  const viewingCurrentMonth =
    viewMonth.getFullYear() === today.getFullYear() &&
    viewMonth.getMonth() === today.getMonth();

  const tree = useVaultStore((s) => s.tree);
  const activePath = useVaultStore((s) => s.activePath);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const openOrCreateDailyNote = useVaultStore((s) => s.openOrCreateDailyNote);
  const chatProjectPath = useChatStore((s) => s.projectPath);

  const diaryRoot = useMemo(
    () =>
      resolveDiaryProjectRoot({
        selectedFolderPath,
        activePath,
        chatProjectPath,
        projectPropertiesByPath,
      }),
    [
      selectedFolderPath,
      activePath,
      chatProjectPath,
      projectPropertiesByPath,
    ],
  );

  const daysWithNotes = useMemo(
    () => (diaryRoot ? collectDailyNoteDayKeys(tree, diaryRoot) : new Set<string>()),
    [tree, diaryRoot],
  );

  const selectedDate = useMemo(() => {
    if (!activePath || !diaryRoot) return null;
    if (!activePath.startsWith(`${diaryRoot}/`)) return null;
    return parseDailyNoteDate(activePath);
  }, [activePath, diaryRoot]);

  const shiftMonth = (delta: number) => {
    setViewMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1),
    );
  };

  const selectDay = (date: Date) => {
    if (date.getMonth() !== viewMonth.getMonth()) {
      setViewMonth(startOfMonth(date));
    }
    if (!diaryRoot) {
      useVaultStore.setState({
        error:
          "Select a diary project (or open a note in one) to use the calendar.",
      });
      return;
    }
    void openOrCreateDailyNote(diaryRoot, date);
  };

  return (
    <div className="sidebar-calendar" role="region" aria-label="Calendar">
      <div className="sidebar-calendar-header">
        <button
          type="button"
          className="sidebar-calendar-nav"
          aria-label="Previous month"
          title="Previous month"
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeftIcon />
        </button>
        <div className="sidebar-calendar-title">{monthLabel(viewMonth)}</div>
        <button
          type="button"
          className="sidebar-calendar-nav"
          aria-label="Next month"
          title="Next month"
          onClick={() => shiftMonth(1)}
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div className="sidebar-calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span key={day} className="sidebar-calendar-weekday">
            {day}
          </span>
        ))}
      </div>

      <div className="sidebar-calendar-grid" role="grid" aria-label="Month">
        {cells.map((date) => {
          const outside = date.getMonth() !== viewMonth.getMonth();
          const isToday = sameDay(date, today);
          const isSelected = selectedDate ? sameDay(date, selectedDate) : false;
          const hasNote = daysWithNotes.has(dayKey(date));
          const className = [
            "sidebar-calendar-day",
            outside ? "is-outside" : "",
            isToday ? "is-today" : "",
            isSelected ? "is-selected" : "",
            hasNote ? "has-note" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const label = date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          });

          return (
            <button
              key={`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`}
              type="button"
              role="gridcell"
              className={className}
              aria-current={isToday ? "date" : undefined}
              aria-selected={isSelected}
              aria-label={hasNote ? `${label}, has note` : label}
              title={label}
              onClick={() => selectDay(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {!viewingCurrentMonth && (
        <button
          type="button"
          className="sidebar-calendar-today"
          onClick={() => {
            setViewMonth(startOfMonth(today));
            selectDay(today);
          }}
        >
          Today
        </button>
      )}
    </div>
  );
}
