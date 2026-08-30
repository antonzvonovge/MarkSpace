import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeAnchoredMenu } from "../../lib/menuPlacement";
import type { TaskPriority } from "../../lib/taskNotes";
import {
  TASK_PRIORITY_NONE,
  TASK_PRIORITY_OPTIONS,
  taskPriorityChipStyle,
  taskPriorityOption,
} from "../../lib/taskPriorities";
import { TasksIconPriorityMark } from "./tasksIcons";

type MenuPos = {
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
  maxHeight: number;
};

type Props = {
  value: TaskPriority | "";
  onChange: (value: TaskPriority | "") => void;
  /** Label when no priority is set (default "Priority"). */
  emptyLabel?: string;
};

const MENU_OPTIONS = [...TASK_PRIORITY_OPTIONS, TASK_PRIORITY_NONE];

/** Priority picker: colored flags in the menu; Material chip when a priority is set. */
export function TasksPriorityPicker({
  value,
  onChange,
  emptyLabel = "Priority",
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = taskPriorityOption(value);
  const hasPriority = value === 1 || value === 2 || value === 3 || value === 4;

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const placed = placeAnchoredMenu(r, {
      gap: 6,
      width: Math.max(r.width, 180),
      maxHeight: 280,
      minHeight: 80,
      prefer: "below",
    });
    setPos({
      left: placed.left,
      top: placed.top,
      bottom: placed.bottom,
      width: placed.width,
      maxHeight: placed.maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
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

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="chat-model-menu tasks-priority-menu"
            role="listbox"
            aria-label="Priority"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top ?? undefined,
              bottom: pos.bottom ?? undefined,
              width: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: 10000,
            }}
          >
            {MENU_OPTIONS.map((opt) => {
              const active =
                opt.value === value ||
                (opt.value === "" && (value === "" || value == null));
              return (
                <button
                  key={opt.value === "" ? "none" : String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={
                    active
                      ? "chat-model-option tasks-priority-option is-active"
                      : "chat-model-option tasks-priority-option"
                  }
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span className="tasks-priority-option-main">
                    <TasksIconPriorityMark color={opt.color} size={16} />
                    <span className="chat-model-option-name">{opt.label}</span>
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="tasks-composer-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={
          hasPriority
            ? "tasks-priority-chip"
            : "tasks-composer-ctrl is-placeholder"
        }
        style={hasPriority ? taskPriorityChipStyle(value) : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Priority"
        title="Priority"
        onClick={() => setOpen((v) => !v)}
      >
        {hasPriority ? (
          <>
            <TasksIconPriorityMark color={selected.color} size={14} />
            <span className="tasks-priority-chip-label">{selected.label}</span>
          </>
        ) : (
          <span className="tasks-composer-ctrl-label">{emptyLabel}</span>
        )}
      </button>
      {menu}
    </div>
  );
}
