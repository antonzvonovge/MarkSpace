import type { ReasoningMode } from "../../ai/types";
import { cycleReasoningMode } from "../../ai/types";

type Props = {
  /** Whether the current model can use reasoning / thinking. */
  supported: boolean;
  mode: ReasoningMode;
  disabled?: boolean;
  /** When false, cycle Off ↔ On (Gem editor). Default true. */
  allowAuto?: boolean;
  onChange: (next: ReasoningMode) => void;
};

function label(mode: ReasoningMode): string {
  if (mode === "auto") return "Auto";
  if (mode === "on") return "On";
  return "Off";
}

function title(supported: boolean, mode: ReasoningMode, allowAuto: boolean): string {
  if (!supported) return "This model does not support reasoning";
  if (mode === "auto") {
    return "Reasoning auto — a worker model decides per message";
  }
  if (mode === "on") {
    return allowAuto
      ? "Reasoning on — click to turn off"
      : "Reasoning on — click to turn off";
  }
  return allowAuto
    ? "Reasoning off — click for Auto"
    : "Reasoning off — click to turn on";
}

/** Off / Auto / On chip for reasoning. */
export function ReasoningToggle({
  supported,
  mode,
  disabled,
  allowAuto = true,
  onChange,
}: Props) {
  const effective: ReasoningMode = supported ? mode : "off";
  const on = supported && effective !== "off";

  const next = () => {
    if (!supported) return;
    if (!allowAuto) {
      onChange(effective === "off" ? "on" : "off");
      return;
    }
    onChange(cycleReasoningMode(effective));
  };

  return (
    <div className="chat-mode-switch" role="group" aria-label="Reasoning">
      <button
        type="button"
        className={on ? (effective === "auto" ? "is-auto" : "is-active") : ""}
        disabled={disabled || !supported}
        aria-pressed={on}
        title={title(supported, effective, allowAuto)}
        aria-label="Reasoning"
        onClick={next}
      >
        {label(effective)}
      </button>
    </div>
  );
}
