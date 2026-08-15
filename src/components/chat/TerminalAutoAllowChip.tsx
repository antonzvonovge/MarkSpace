type Props = {
  visible: boolean;
  disabled?: boolean;
  onRevoke: () => void;
};

/** Shown while this chat auto-allows terminal commands. Click to revoke. */
export function TerminalAutoAllowChip({ visible, disabled, onRevoke }: Props) {
  if (!visible) return null;
  return (
    <button
      type="button"
      className="chat-terminal-auto-allow"
      disabled={disabled}
      aria-pressed
      title="Terminal commands run without asking in this chat — click to require approval again"
      aria-label="Terminal auto-allow on. Click to turn off."
      onClick={onRevoke}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4.22 5.22a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 0 1 0 1.06l-2.5 2.5a.75.75 0 1 1-1.06-1.06L6.19 8.25 4.22 6.28a.75.75 0 0 1 0-1.06zM8.75 10a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H9.5A.75.75 0 0 1 8.75 10z"
        />
      </svg>
    </button>
  );
}
