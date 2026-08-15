import { useDiarySettingsStore } from "../store/diarySettingsStore";

type Props = {
  value: string;
  onChange: (id: string) => void;
  labelledBy?: string;
};

export function DayMarkerPicker({ value, onChange, labelledBy }: Props) {
  const markers = useDiarySettingsStore((s) => s.markers);

  return (
    <div
      className="day-marker-picker"
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : "Day marker"}
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === ""}
        aria-label="None"
        title="None"
        className={`day-marker-swatch is-none${value === "" ? " is-selected" : ""}`}
        onClick={() => onChange("")}
      >
        <span className="day-marker-swatch-none-x" aria-hidden>
          ×
        </span>
      </button>
      {markers.map((marker) => (
        <button
          key={marker.id}
          type="button"
          role="radio"
          aria-checked={value === marker.id}
          aria-label={marker.label}
          title={marker.label}
          className={`day-marker-swatch${value === marker.id ? " is-selected" : ""}`}
          onClick={() => onChange(marker.id)}
        >
          <span aria-hidden>{marker.emoji}</span>
        </button>
      ))}
    </div>
  );
}
