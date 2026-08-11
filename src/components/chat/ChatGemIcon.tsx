/** Shared robot-head glyph for Gems (tab badges, menu, banner). */
export function ChatGemIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {/* Antenna stem + tip */}
      <path
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        d="M8 1.25v2"
      />
      <circle cx="8" cy="1.25" r="1" fill="currentColor" />
      {/* Head */}
      <rect
        x="3"
        y="3.25"
        width="10"
        height="9.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      {/* Eyes */}
      <circle cx="6" cy="7.25" r="1.15" fill="currentColor" />
      <circle cx="10" cy="7.25" r="1.15" fill="currentColor" />
      {/* Mouth */}
      <path
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        d="M6 10.75h4"
      />
    </svg>
  );
}
