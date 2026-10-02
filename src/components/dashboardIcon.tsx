/** Outline dashboard mark. Color comes from the parent (`currentColor`). */
export function DashboardIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.75"
        y="1.75"
        width="5.1"
        height="5.1"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect
        x="9.15"
        y="1.75"
        width="5.1"
        height="5.1"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect
        x="1.75"
        y="9.15"
        width="12.5"
        height="5.1"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}
