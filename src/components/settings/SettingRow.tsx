import type { PrefKey, Prefs } from "../../settings/types";
import type { SettingDescriptor } from "../../settings/registry";

type Props = {
  setting: SettingDescriptor;
  value: Prefs[PrefKey];
  onChange: (value: Prefs[PrefKey]) => void;
};

export function SettingRow({ setting, value, onChange }: Props) {
  const { control } = setting;

  return (
    <div className="setting-row">
      <div className="setting-row-text">
        <div className="setting-row-label">{setting.label}</div>
        <div className="setting-row-desc">{setting.description}</div>
      </div>
      <div className="setting-row-control">
        {control.type === "enum" ? (
          <select
            className="setting-select"
            value={String(value)}
            aria-label={setting.label}
            onChange={(e) => onChange(e.target.value as Prefs[PrefKey])}
          >
            {control.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="setting-number"
            type="number"
            min={control.min}
            max={control.max}
            step={control.step ?? 1}
            value={Number(value)}
            aria-label={setting.label}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              const clamped = Math.min(
                control.max,
                Math.max(control.min, Math.round(n)),
              );
              onChange(clamped as Prefs[PrefKey]);
            }}
          />
        )}
      </div>
    </div>
  );
}
