type SectionCollapseChevronProps = {
  open: boolean;
  label: string;
  onToggle: () => void;
};

/** Left chevron on a section header. Collapses that section’s whole tree. */
export function SectionCollapseChevron({
  open,
  label,
  onToggle,
}: SectionCollapseChevronProps) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="tree-chevron-btn"
      aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg
        className={open ? "tree-chevron-icon is-open" : "tree-chevron-icon"}
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 3.75 10.25 8 6 12.25"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
