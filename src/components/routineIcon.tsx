import { PROJECT_COLOR_SWATCHES } from "../lib/projectColors";

/** Saturated swatches. Lime and amber disappear on the light sidebar. */
const ROUTINE_ICON_COLORS = PROJECT_COLOR_SWATCHES.flatMap((swatch) =>
  swatch.hex === "#cddc39" || swatch.hex === "#ffc107" ? [] : [swatch.hex],
);

export function routineIconColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return ROUTINE_ICON_COLORS[hash % ROUTINE_ICON_COLORS.length] ?? ROUTINE_ICON_COLORS[0];
}

/** Flat clock used in the sidebar and on routine tabs. */
export function RoutineColorIcon({ tight = false }: { tight?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox={tight ? "3.05 3.05 9.9 9.9" : "0 0 16 16"}
      fill="none"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8 3.15a4.85 4.85 0 1 0 .01 0ZM7.42 4.35h1.16V7.42H10.7v1.16H7.42Z"
      />
    </svg>
  );
}
