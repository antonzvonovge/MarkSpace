import {
  FcCalendar,
  FcFlowChart,
  FcFolder,
  FcLink,
  FcReading,
  FcTimeline,
} from "react-icons/fc";

export function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TodayCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="3.25"
        width="11"
        height="10.25"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M5.25 2.5v1.8M10.75 2.5v1.8M2.75 6.4h10.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M5.6 10.15 7.15 11.6 10.5 8.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PencilIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM9.75 4.81L4.53 10.03a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.25.25 0 00.108-.064L11.19 6.25 9.75 4.81z" />
    </svg>
  );
}

/** Vertical thumbtack (VS Code / Cursor pinned tab). */
export function PinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.5 1.5 5 2v4.5L3.5 8.5v1h4V15h1V9.5h4v-1L11 6.5V2l-.5-.5h-5ZM6 2.5h4v4.2l1.5 1.8h-7L6 6.7V2.5Z"
      />
    </svg>
  );
}

export function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? "tree-refresh-icon is-spinning" : "tree-refresh-icon"}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 8a5 5 0 0 1 8.9-2.1M13 4v2.5H10.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 8a5 5 0 0 1-8.9 2.1M3 12v-2.5H5.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CollapseAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 5.25 8 9.75l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 9.25 8 13.75l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LocateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.75" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M8 2.25v2.25M8 11.5v2.25M2.25 8h2.25M11.5 8h2.25"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CollectionPlusIcon({ size = 16 }: { size?: number }) {
  return <FcFolder size={size} />;
}

export function DiagramIcon({ size = 16 }: { size?: number }) {
  return <FcFlowChart size={size} />;
}

export function LinksIcon({ size = 16 }: { size?: number }) {
  return <FcLink size={size} />;
}

export function DictionaryIcon({ size = 16 }: { size?: number }) {
  return <FcReading size={size} />;
}

export function HabitTrackerIcon({ size = 16 }: { size?: number }) {
  return <FcCalendar size={size} />;
}

export function CourseTrackerIcon({ size = 16 }: { size?: number }) {
  return <FcTimeline size={size} />;
}

export function PdfIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.25 2.5h5.1L11.75 5v8.5a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M9.25 2.5V5h2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.4 10.2h5.2M5.4 7.8h3.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GraphIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="4" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="12" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5.4 4.6 10.6 5.2M4.8 5.5 7.3 10.7M11.3 6.3 8.9 10.6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Vault root — outline safe, matches Favorites/Comments section icons. */
export function VaultSectionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="3.25"
        width="11"
        height="9.5"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <circle cx="8" cy="8" r="2.15" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="0.65" fill="currentColor" />
      <path
        d="M4.35 12.75v1M11.65 12.75v1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Sidebar Incoming section — inbox tray, same weight as vault/comments. */
export function IncomingSectionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 8.25 4.15 4.7A1.4 1.4 0 0 1 5.4 4h5.2a1.4 1.4 0 0 1 1.25.7L13.5 8.25v3.5A1.25 1.25 0 0 1 12.25 13h-8.5A1.25 1.25 0 0 1 2.5 11.75v-3.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 8.25h2.35l.85 1.6h4.6l.85-1.6H13.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Sidebar Favorites section — outline star, same weight as vault/comments. */
export function FavoritesSectionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.35 9.72 5.9l3.9.42-2.95 2.7.88 3.8L8 10.95l-3.55 1.87.88-3.8-2.95-2.7 3.9-.42L8 2.35Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Sidebar Comments section — quiet outline bubble. */
export function CommentsSectionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.25 3.5h9.5a1.25 1.25 0 0 1 1.25 1.25v5a1.25 1.25 0 0 1-1.25 1.25H7.4L4.6 13.2V11H3.25A1.25 1.25 0 0 1 2 9.75v-5A1.25 1.25 0 0 1 3.25 3.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M5.25 6.75h5.5M5.25 9h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Sidebar Tasks section — quiet outline checklist. */
export function TasksSectionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M5.1 8.05 6.85 9.7 10.9 5.9"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Todoist-style Inbox tray for Tasks sidebar. */
export function TasksInboxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 8.25 4.15 4.7A1.4 1.4 0 0 1 5.4 4h5.2a1.4 1.4 0 0 1 1.25.7L13.5 8.25v3.5A1.25 1.25 0 0 1 12.25 13h-8.5A1.25 1.25 0 0 1 2.5 11.75v-3.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 8.25h2.35l.85 1.6h4.6l.85-1.6H13.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Todoist-style Today — calendar with check. */
export function TasksTodayIcon() {
  return <TodayCheckIcon />;
}

/** All tasks — stacked checklist. */
export function TasksAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 4.5h9M3.5 8h9M3.5 11.5h6.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M11.1 10.35 12.1 11.35 14 9.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Filters — funnel. */
export function TasksFiltersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.75 3.5h10.5L9.4 8.15v3.6L6.6 13.25V8.15L2.75 3.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Task list / project — Todoist-style hash mark. */
export function TasksListIcon({ color }: { color?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={color ? { color } : undefined}
    >
      <path
        d="M6.1 3.5 5.2 12.5M10.8 3.5 9.9 12.5M3.5 6.15h9M3.25 9.85h9"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}
