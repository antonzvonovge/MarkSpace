import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayPicker } from "react-day-picker";
import { placeAnchoredMenu } from "../../lib/menuPlacement";
import { localDateYmd } from "../../lib/taskNotes";
import { TasksIconSchedule } from "./tasksIcons";
import "react-day-picker/style.css";

type Pos = {
  left: number;
  top: number | null;
  bottom: number | null;
  maxHeight: number;
};

function parseYmd(value: string | null | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function formatDisplay(
  ymd: string | null | undefined,
  emptyLabel: string,
): string {
  const d = parseYmd(ymd);
  if (!d) return emptyLabel;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function placeFromPoint(x: number, y: number): Pos {
  const placed = placeAnchoredMenu(
    {
      x,
      y,
      width: 0,
      height: 0,
      top: y,
      left: x,
      right: x,
      bottom: y,
      toJSON() {
        return this;
      },
    },
    {
      gap: 6,
      width: 400,
      maxHeight: 420,
      minHeight: 280,
      prefer: "below",
      align: "start",
    },
  );
  return {
    left: placed.left,
    top: placed.top,
    bottom: placed.bottom,
    maxHeight: placed.maxHeight,
  };
}

/** Single anchored due-date popup (one instance for the whole task list). */
export function TasksDuePickerPopup({
  anchor,
  value,
  onChange,
  onClose,
  "aria-label": ariaLabel = "Due date",
}: {
  anchor: { x: number; y: number };
  value: string | null;
  onChange: (ymd: string | null) => void;
  onClose: () => void;
  "aria-label"?: string;
}) {
  const [pos, setPos] = useState<Pos>(() =>
    placeFromPoint(anchor.x, anchor.y),
  );
  const [month, setMonth] = useState<Date>(() => parseYmd(value) ?? new Date());
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = parseYmd(value);

  useLayoutEffect(() => {
    setPos(placeFromPoint(anchor.x, anchor.y));
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onReposition = () => setPos(placeFromPoint(anchor.x, anchor.y));
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [anchor.x, anchor.y, onClose]);

  useEffect(() => {
    const d = parseYmd(value);
    if (d) setMonth(d);
  }, [value]);

  const pick = (d: Date | undefined) => {
    if (!d) {
      onChange(null);
      onClose();
      return;
    }
    onChange(localDateYmd(d));
    onClose();
  };

  const today = new Date();
  const presets: { label: string; date: Date | null }[] = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "Next week", date: addDays(today, 7) },
    { label: "Clear", date: null },
  ];

  return createPortal(
    <div
      ref={panelRef}
      className="tasks-date-panel"
      role="dialog"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top ?? undefined,
        bottom: pos.bottom ?? undefined,
        maxHeight: pos.maxHeight,
        zIndex: 10050,
      }}
    >
      <DayPicker
        className="tasks-daypicker"
        mode="single"
        animate
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={pick}
        showOutsideDays
      />
      <div className="tasks-date-presets">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className={
              p.date && value === localDateYmd(p.date)
                ? "tasks-date-preset is-active"
                : "tasks-date-preset"
            }
            onClick={() => {
              if (p.date == null) {
                onChange(null);
                onClose();
                return;
              }
              pick(p.date);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

type Props = {
  value: string | null;
  onChange: (ymd: string | null) => void;
  /** Compact chip / field / icon-only (task row hover). */
  variant?: "chip" | "field" | "icon";
  /** Label shown when no date is set (default "Due"). */
  emptyLabel?: string;
  "aria-label"?: string;
};

export function TasksDateField({
  value,
  onChange,
  variant = "field",
  emptyLabel = "Due",
  "aria-label": ariaLabel = "Due date",
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [month, setMonth] = useState<Date>(() => parseYmd(value) ?? new Date());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = parseYmd(value);

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const placed = placeAnchoredMenu(r, {
      gap: 6,
      width: 400,
      maxHeight: 420,
      minHeight: 280,
      prefer: "below",
      align: "start",
    });
    setPos({
      left: placed.left,
      top: placed.top,
      bottom: placed.bottom,
      maxHeight: placed.maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onReposition = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    const d = parseYmd(value);
    if (d) setMonth(d);
  }, [value]);

  const pick = (d: Date | undefined) => {
    if (!d) {
      onChange(null);
      return;
    }
    onChange(localDateYmd(d));
    setOpen(false);
  };

  const today = new Date();
  const presets: { label: string; date: Date | null }[] = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "Next week", date: addDays(today, 7) },
    { label: "Clear", date: null },
  ];

  const panel =
    open && pos
      ? createPortal(
          <div
            ref={panelRef}
            className="tasks-date-panel"
            role="dialog"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top ?? undefined,
              bottom: pos.bottom ?? undefined,
              maxHeight: pos.maxHeight,
              zIndex: 10050,
            }}
          >
            <DayPicker
              className="tasks-daypicker"
              mode="single"
              animate
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              onSelect={pick}
              showOutsideDays
            />
            <div className="tasks-date-presets">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={
                    p.date && value === localDateYmd(p.date)
                      ? "tasks-date-preset is-active"
                      : "tasks-date-preset"
                  }
                  onClick={() => {
                    if (p.date == null) {
                      onChange(null);
                      setOpen(false);
                      return;
                    }
                    pick(p.date);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={
          variant === "icon"
            ? value
              ? "tasks-date-trigger is-icon has-value"
              : "tasks-date-trigger is-icon"
            : variant === "chip"
              ? value
                ? "tasks-composer-ctrl tasks-date-trigger is-chip has-value"
                : "tasks-composer-ctrl tasks-date-trigger is-chip"
              : value
                ? "tasks-date-trigger is-field has-value"
                : "tasks-date-trigger is-field"
        }
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={formatDisplay(value, emptyLabel)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {variant === "icon" ? (
          <TasksIconSchedule size={24} />
        ) : (
          <>
            {value || emptyLabel !== "+" ? (
              <svg
                className="tasks-date-trigger-icon"
                width="12"
                height="12"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <rect
                  x="2.5"
                  y="3.25"
                  width="11"
                  height="10.25"
                  rx="1.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M5.25 2.5v1.8M10.75 2.5v1.8M2.75 6.4h10.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            ) : null}
            <span className="tasks-composer-ctrl-label">
              {formatDisplay(value, emptyLabel)}
            </span>
          </>
        )}
      </button>
      {panel}
    </>
  );
}
