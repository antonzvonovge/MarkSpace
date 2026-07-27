import { useMemo, useState } from "react";
import {
  CATEGORIES,
  SETTINGS_REGISTRY,
  matchesQuery,
  settingsForCategory,
  type SettingCategory,
} from "../../settings/registry";
import type { PrefKey } from "../../settings/types";
import { usePrefsStore } from "../../store/prefsStore";
import { SettingRow } from "./SettingRow";

type Props = {
  onClose: () => void;
};

export function SettingsPage({ onClose }: Props) {
  const prefs = usePrefsStore((s) => s.prefs);
  const setPref = usePrefsStore((s) => s.setPref);
  const [category, setCategory] = useState<SettingCategory>("appearance");
  const [query, setQuery] = useState("");

  const searching = query.trim().length > 0;

  const rows = useMemo(() => {
    if (searching) {
      return SETTINGS_REGISTRY.filter((s) => matchesQuery(s, query));
    }
    return settingsForCategory(category);
  }, [category, query, searching]);

  const grouped = useMemo(() => {
    if (!searching) return null;
    return CATEGORIES.map((cat) => ({
      ...cat,
      settings: rows.filter((s) => s.category === cat.id),
    })).filter((g) => g.settings.length > 0);
  }, [rows, searching]);

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div className="settings-header-title">
          <h1>Settings</h1>
          <p>Configure MarkSpace</p>
        </div>
        <button
          type="button"
          className="settings-close"
          aria-label="Close settings"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="settings-search-wrap">
        <input
          className="settings-search"
          type="search"
          placeholder="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      <div className="settings-body">
        {!searching && (
          <nav className="settings-nav" aria-label="Settings categories">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={
                  category === cat.id
                    ? "settings-nav-item is-active"
                    : "settings-nav-item"
                }
                onClick={() => setCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </nav>
        )}

        <div className="settings-list">
          {rows.length === 0 && (
            <div className="settings-empty">No settings match “{query.trim()}”</div>
          )}

          {searching &&
            grouped?.map((group) => (
              <section key={group.id} className="settings-section">
                <h2 className="settings-section-title">{group.label}</h2>
                {group.settings.map((setting) => (
                  <SettingRow
                    key={setting.id}
                    setting={setting}
                    value={prefs[setting.id]}
                    onChange={(value) => setPref(setting.id as PrefKey, value)}
                  />
                ))}
              </section>
            ))}

          {!searching &&
            rows.map((setting) => (
              <SettingRow
                key={setting.id}
                setting={setting}
                value={prefs[setting.id]}
                onChange={(value) => setPref(setting.id as PrefKey, value)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
