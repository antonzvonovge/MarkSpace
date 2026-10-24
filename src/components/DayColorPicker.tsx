import {
  PROJECT_COLOR_SWATCHES,
  normalizeProjectColor,
} from "../lib/projectColors";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  labelledBy?: string;
  "aria-label"?: string;
  /** When false, omit the “None” swatch (e.g. dashboard icons always keep a color). */
  allowNone?: boolean;
};

export function DayColorPicker({
  value,
  onChange,
  labelledBy,
  "aria-label": ariaLabel = "Day color",
  allowNone = true,
}: Props) {
  const selected = normalizeProjectColor(value);

  return (
    <div
      className="project-color-picker"
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : ariaLabel}
    >
      {allowNone ? (
        <button
          type="button"
          role="radio"
          aria-checked={selected === ""}
          aria-label="None"
          title="None"
          className={`project-color-swatch is-none${selected === "" ? " is-selected" : ""}`}
          onClick={() => onChange("")}
        >
          <span className="project-color-swatch-none-x" aria-hidden>
            ×
          </span>
        </button>
      ) : null}
      {PROJECT_COLOR_SWATCHES.map((swatch) => (
        <button
          key={swatch.id}
          type="button"
          role="radio"
          aria-checked={selected === swatch.hex}
          aria-label={swatch.label}
          title={swatch.label}
          className={`project-color-swatch${selected === swatch.hex ? " is-selected" : ""}`}
          style={{ background: swatch.hex }}
          onClick={() => onChange(swatch.hex)}
        />
      ))}
    </div>
  );
}
