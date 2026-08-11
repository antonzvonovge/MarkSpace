type Props = {
  /** Whether the current model can use reasoning / thinking. */
  supported: boolean;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
};

/** Sticky on/off chip for reasoning — same chrome as Ask/Agent switch. */
export function ReasoningToggle({
  supported,
  value,
  disabled,
  onChange,
}: Props) {
  const on = supported && value;
  return (
    <div className="chat-mode-switch" role="group" aria-label="Reasoning">
      <button
        type="button"
        className={on ? "is-active" : ""}
        disabled={disabled || !supported}
        aria-pressed={on}
        title={
          !supported
            ? "This model does not support reasoning"
            : on
              ? "Reasoning on — click to turn off"
              : "Reasoning off — click to turn on"
        }
        aria-label="Reasoning"
        onClick={() => onChange(!value)}
      >
        Reasoning
      </button>
    </div>
  );
}
