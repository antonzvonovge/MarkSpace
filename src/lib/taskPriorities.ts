import type { CSSProperties } from "react";
import type { TaskPriority } from "./taskNotes";

export type TaskPriorityOption = {
  value: TaskPriority | "";
  /** English UI label (no P1/P2 suffixes). */
  label: string;
  /** Stroke / ink for the flag icon. */
  color: string;
  /** Soft matte Material fill for the selected chip. */
  chipBg: string;
  chipBgHover: string;
  chipBorder: string;
};

/** Do / Schedule / Delegate / Postponed + None — stored as priority 1–4. */
export const TASK_PRIORITY_OPTIONS: readonly TaskPriorityOption[] = [
  {
    value: 1,
    label: "Do",
    color: "#e53935",
    chipBg: "#fdecea",
    chipBgHover: "#fadbd8",
    chipBorder: "#f5c6c2",
  },
  {
    value: 2,
    label: "Schedule",
    color: "#fb8c00",
    chipBg: "#fff3e0",
    chipBgHover: "#ffe0b2",
    chipBorder: "#ffcc80",
  },
  {
    value: 3,
    label: "Delegate",
    color: "#f9a825",
    chipBg: "#fff8e1",
    chipBgHover: "#ffecb3",
    chipBorder: "#ffe082",
  },
  {
    value: 4,
    label: "Postponed",
    color: "#42a5f5",
    chipBg: "#e3f2fd",
    chipBgHover: "#bbdefb",
    chipBorder: "#90caf9",
  },
] as const;

export const TASK_PRIORITY_NONE: TaskPriorityOption = {
  value: "",
  label: "None",
  color: "#9e9e9e",
  chipBg: "transparent",
  chipBgHover: "transparent",
  chipBorder: "transparent",
};

export function taskPriorityOption(
  priority: TaskPriority | "" | null | undefined,
): TaskPriorityOption {
  if (priority === 1 || priority === 2 || priority === 3 || priority === 4) {
    return TASK_PRIORITY_OPTIONS[priority - 1]!;
  }
  return TASK_PRIORITY_NONE;
}

export function taskPriorityChipStyle(
  priority: TaskPriority,
): CSSProperties {
  const o = taskPriorityOption(priority);
  return {
    background: o.chipBg,
    borderColor: o.chipBorder,
    color: o.color,
  };
}
