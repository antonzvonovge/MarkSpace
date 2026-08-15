type Props = {
  visible: boolean;
  disabled?: boolean;
  onRevoke: () => void;
};

/** Shown while this chat auto-allows terminal commands. Click to revoke. */
export function TerminalAutoAllowChip({ visible, disabled, onRevoke }: Props) {
  if (!visible) return null;
  return (
    <div className="chat-mode-switch" role="group" aria-label="Terminal auto-allow">
      <button
        type="button"
        className="is-active"
        disabled={disabled}
        aria-pressed
        title="Terminal commands run without asking in this chat — click to require approval again"
        aria-label="Terminal auto-allow on. Click to turn off."
        onClick={onRevoke}
      >
        Auto-allow
      </button>
    </div>
  );
}
