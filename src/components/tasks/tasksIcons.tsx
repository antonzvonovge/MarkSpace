/** Task-row icons traced to match Todoist web stroke style (24×24, thin outline). */

type IconProps = { size?: number; className?: string };

/** Todoist web drag handle (24×24, six dots). */
export function TasksIconGrip({ size = 24, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M14.5 15.5a1.5 1.5 0 1 1-.001 3.001A1.5 1.5 0 0 1 14.5 15.5m-5 0a1.5 1.5 0 1 1-.001 3.001A1.5 1.5 0 0 1 9.5 15.5m5-5a1.5 1.5 0 1 1-.001 3.001A1.5 1.5 0 0 1 14.5 10.5m-5 0a1.5 1.5 0 1 1-.001 3.001A1.5 1.5 0 0 1 9.5 10.5m5-5a1.5 1.5 0 1 1-.001 3.001A1.5 1.5 0 0 1 14.5 5.5m-5 0a1.5 1.5 0 1 1-.001 3.001A1.5 1.5 0 0 1 9.5 5.5" />
    </svg>
  );
}

export function TasksIconEdit({ size = 24, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 19.5h3.1L18.2 8.9a1.75 1.75 0 0 0 0-2.48l-.62-.62a1.75 1.75 0 0 0-2.48 0L4.5 16.4v3.1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m13.7 7.4 2.9 2.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Todoist “schedule / due” glyph: square with a small mark bottom-right. */
export function TasksIconSchedule({ size = 24, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="4.75"
        y="4.75"
        width="14.5"
        height="14.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="13.25" y="13.25" width="3.5" height="3.5" rx="0.6" fill="currentColor" />
    </svg>
  );
}

export function TasksIconComment({ size = 24, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5.5 5.75h13a1.75 1.75 0 0 1 1.75 1.75v7a1.75 1.75 0 0 1-1.75 1.75H11.2L7.25 19.5v-3.25H5.5A1.75 1.75 0 0 1 3.75 14.5v-7A1.75 1.75 0 0 1 5.5 5.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TasksIconMore({ size = 24, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="6" cy="12" r="1.65" />
      <circle cx="12" cy="12" r="1.65" />
      <circle cx="18" cy="12" r="1.65" />
    </svg>
  );
}

/** Todoist subtask progress glyph (branch + two hollow nodes). */
export function TasksIconSubtasks({ size = 16, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <g
        stroke="currentColor"
        fill="none"
        transform="translate(5 5)"
      >
        <path d="M10.5 12.5H8.044c-1.928 0-2.627-.2-3.332-.578a3.92 3.92 0 0 1-1.634-1.634C2.7 9.583 2.5 8.884 2.5 6.956V4.5" />
        <circle cx="2.5" cy="2.5" r="2" />
        <circle cx="12.5" cy="12.5" r="2" />
      </g>
    </svg>
  );
}

export function TasksIconChevron({
  open,
  size = 16,
  className,
}: IconProps & { open: boolean }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.12s ease",
      }}
    >
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Idle “Add task” plus (thin stroke, no fill) — Todoist rest state. */
export function TasksIconAddPlusIdle({ size = 18, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 3.75v10.5M3.75 9h10.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Hover/active “Add task” — filled circle with white plus. */
export function TasksIconAddPlusActive({ size = 18, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="9" fill="currentColor" />
      <path
        d="M9 4.6v8.8M4.6 9h8.8"
        stroke="#fff"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
