import {
  PROJECT_COLOR_SWATCHES,
  normalizeProjectColor,
} from "../lib/projectColors";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  labelledBy?: string;
};

export function DayColorPicker({ value, onChange, labelledBy }: Props) {
  const selected = normalizeProjectColor(value);

  return (
    <div
      className="project-color-picker"
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : "Day color"}
    >
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
