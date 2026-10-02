/** Flat dashboard mark. Color comes from the parent (`currentColor`). */
export function DashboardIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="1.25" y="1.25" width="6" height="6" rx="1.2" />
      <rect x="8.75" y="1.25" width="6" height="6" rx="1.2" />
      <rect x="1.25" y="8.75" width="13.5" height="6" rx="1.2" />
    </svg>
  );
}
