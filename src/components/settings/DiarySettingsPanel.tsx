import { useEffect, useState } from "react";
import { useListReorder } from "../../hooks/useListReorder";
import {
  DEFAULT_DAY_MARKERS,
  MAX_DAY_MARKERS,
  MAX_DAY_MARKER_EMOJI_CHARS,
  MAX_DAY_MARKER_LABEL,
  normalizeDayMarkerEmoji,
  normalizeDayMarkerLabel,
  slugifyDayMarkerId,
  type DayMarker,
} from "../../lib/dayMarkers";
import { useDiarySettingsStore } from "../../store/diarySettingsStore";
import { useVaultStore } from "../../store/vaultStore";

function sameCatalog(a: readonly DayMarker[], b: readonly DayMarker[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (m, i) =>
        m.id === b[i]?.id && m.emoji === b[i]?.emoji && m.label === b[i]?.label,
    )
  );
}

export function DiarySettingsPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const stored = useDiarySettingsStore((s) => s.markers);
  const hydrate = useDiarySettingsStore((s) => s.hydrateForVault);
  const setMarkers = useDiarySettingsStore((s) => s.setMarkers);
  const resetToDefaults = useDiarySettingsStore((s) => s.resetToDefaults);
  const [draft, setDraft] = useState<DayMarker[]>(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate(vaultPath);
  }, [vaultPath, hydrate]);

  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  const bindReorder = useListReorder(draft.length, (from, to) => {
    if (from === to) return;
    const next = draft.slice();
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    setDraft(next);
    void save(next);
  });

  const save = async (next: DayMarker[]) => {
    setBusy(true);
    setError(null);
    try {
      await setMarkers(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const commitIfChanged = (next: DayMarker[]) => {
    if (sameCatalog(next, stored)) return;
    void save(next);
  };

  const addMarker = () => {
    if (draft.length >= MAX_DAY_MARKERS) return;
    const ids = draft.map((m) => m.id);
    const label = "New marker";
    const id = slugifyDayMarkerId(label, ids);
    const next = [...draft, { id, emoji: "⭐", label }];
    setDraft(next);
    void save(next);
  };

  if (!vaultPath) {
    return (
      <div className="sync-panel">
        <p className="sync-panel-lead">
          Open a vault to edit the diary day-marker catalog. The catalog is
          stored in this vault and syncs with it.
        </p>
      </div>
    );
  }

  return (
    <div className="sync-panel">
      <p className="sync-panel-lead sync-panel-vault">
        Settings for this vault only
        <code className="sync-vault-path" title={vaultPath}>
          {vaultPath}
        </code>
      </p>

      <section className="sync-block">
        <h3 className="sync-block-title">Day markers</h3>
        <p className="sync-block-desc">
          Emoji shown on the sidebar calendar. Stored as{" "}
          <code>.markspace/diary.json</code>. Daily notes keep a{" "}
          <code>marker:</code> id from this list.
        </p>

        <ul className="diary-marker-settings-list">
          {draft.map((marker, index) => {
            const reorder = bindReorder(index);
            return (
              <li
                key={marker.id}
                className={`diary-marker-settings-row ${reorder.className}`.trim()}
                draggable={reorder.draggable}
                onDragStart={reorder.onDragStart}
                onDragEnd={reorder.onDragEnd}
                onDragOver={reorder.onDragOver}
                onDragLeave={reorder.onDragLeave}
                onDrop={reorder.onDrop}
              >
                <input
                  className="diary-marker-emoji-input"
                  type="text"
                  aria-label={`Emoji for ${marker.label}`}
                  value={marker.emoji}
                  maxLength={MAX_DAY_MARKER_EMOJI_CHARS * 2}
                  disabled={busy}
                  spellCheck={false}
                  onChange={(e) => {
                    setDraft((rows) =>
                      rows.map((m, i) =>
                        i === index ? { ...m, emoji: e.target.value } : m,
                      ),
                    );
                  }}
                  onBlur={() => {
                    const emoji =
                      normalizeDayMarkerEmoji(draft[index]?.emoji) ||
                      stored[index]?.emoji ||
                      "⭐";
                    const next = draft.map((m, i) =>
                      i === index ? { ...m, emoji } : m,
                    );
                    setDraft(next);
                    commitIfChanged(next);
                  }}
                />
                <input
                  className="diary-marker-label-input"
                  type="text"
                  aria-label={`Label for ${marker.id}`}
                  value={marker.label}
                  maxLength={MAX_DAY_MARKER_LABEL}
                  disabled={busy}
                  onChange={(e) => {
                    setDraft((rows) =>
                      rows.map((m, i) =>
                        i === index ? { ...m, label: e.target.value } : m,
                      ),
                    );
                  }}
                  onBlur={() => {
                    const label =
                      normalizeDayMarkerLabel(draft[index]?.label) ||
                      stored[index]?.label ||
                      "Marker";
                    const next = draft.map((m, i) =>
                      i === index ? { ...m, label } : m,
                    );
                    setDraft(next);
                    commitIfChanged(next);
                  }}
                />
                <span className="diary-marker-id" title="Stored in YAML marker:">
                  {marker.id}
                </span>
                <button
                  type="button"
                  className="diary-marker-remove"
                  aria-label={`Remove ${marker.label}`}
                  disabled={busy}
                  onClick={() => {
                    if (reorder.shouldIgnoreClick()) return;
                    const next = draft.filter((_, i) => i !== index);
                    setDraft(next);
                    void save(next);
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>

        {draft.length === 0 && (
          <p className="sync-block-desc">
            No day markers. Add one or reset to defaults.
          </p>
        )}

        <div className="sync-actions">
          <button
            type="button"
            className="sync-btn sync-btn-primary"
            disabled={busy || draft.length >= MAX_DAY_MARKERS}
            onClick={addMarker}
          >
            Add marker
          </button>
          <button
            type="button"
            className="sync-btn"
            disabled={busy || sameCatalog(draft, DEFAULT_DAY_MARKERS)}
            onClick={() => void resetToDefaults()}
          >
            Reset to defaults
          </button>
        </div>
        {error && <p className="embedding-model-error">{error}</p>}
      </section>
    </div>
  );
}
