import { useEffect, useMemo, useState } from "react";
import { useListReorder } from "../../hooks/useListReorder";
import {
  DEFAULT_FILE_MARKERS,
  MAX_FILE_MARKERS,
  MAX_FILE_MARKER_EMOJI_CHARS,
  MAX_FILE_MARKER_LABEL,
  normalizeFileMarkerEmoji,
  normalizeFileMarkerId,
  normalizeFileMarkerLabel,
  slugifyFileMarkerId,
  type FileMarker,
} from "../../lib/fileMarkers";
import { useFileMarkerSettingsStore } from "../../store/fileMarkerSettingsStore";
import { useVaultStore } from "../../store/vaultStore";

type DraftRow = {
  /** Stable React key (not shown to the user). */
  key: string;
  /** Empty for newly added rows; assigned from the label on Save. */
  id: string;
  emoji: string;
  label: string;
};

function draftFromStored(markers: readonly FileMarker[]): DraftRow[] {
  return markers.map((m) => ({
    key: m.id,
    id: m.id,
    emoji: m.emoji,
    label: m.label,
  }));
}

function sameAsStored(
  draft: readonly DraftRow[],
  stored: readonly FileMarker[],
): boolean {
  if (draft.length !== stored.length) return false;
  return draft.every(
    (d, i) =>
      d.id === stored[i]?.id &&
      d.emoji === stored[i]?.emoji &&
      d.label === stored[i]?.label,
  );
}

function newDraftKey(): string {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize draft rows into a catalog; new rows get ids from their labels. */
function commitDraft(draft: readonly DraftRow[]): FileMarker[] {
  const used: string[] = [];
  const out: FileMarker[] = [];
  for (const row of draft) {
    const emoji = normalizeFileMarkerEmoji(row.emoji) || "✅";
    const label = normalizeFileMarkerLabel(row.label) || "Marker";
    const existing = normalizeFileMarkerId(row.id);
    const id = existing || slugifyFileMarkerId(label, used);
    used.push(id);
    out.push({ id, emoji, label });
    if (out.length >= MAX_FILE_MARKERS) break;
  }
  return out;
}

export function FileMarkersSettingsPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const stored = useFileMarkerSettingsStore((s) => s.markers);
  const hydrate = useFileMarkerSettingsStore((s) => s.hydrateForVault);
  const setMarkers = useFileMarkerSettingsStore((s) => s.setMarkers);
  const [draft, setDraft] = useState<DraftRow[]>(() => draftFromStored(stored));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () => !sameAsStored(draft, stored),
    [draft, stored],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrate(vaultPath);
      if (cancelled) return;
      setDraft(
        draftFromStored(useFileMarkerSettingsStore.getState().markers),
      );
      setError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [vaultPath, hydrate]);

  useEffect(() => {
    if (!dirty) {
      setDraft(draftFromStored(stored));
    }
  }, [stored, dirty]);

  const bindReorder = useListReorder(draft.length, (from, to) => {
    if (from === to) return;
    setDraft((rows) => {
      const next = rows.slice();
      const [item] = next.splice(from, 1);
      if (!item) return rows;
      next.splice(to, 0, item);
      return next;
    });
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = commitDraft(draft);
      await setMarkers(next);
      setDraft(draftFromStored(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addMarker = () => {
    if (draft.length >= MAX_FILE_MARKERS) return;
    setDraft((rows) => [
      ...rows,
      { key: newDraftKey(), id: "", emoji: "✅", label: "" },
    ]);
  };

  const resetDraftToDefaults = () => {
    setDraft(draftFromStored(DEFAULT_FILE_MARKERS));
  };

  if (!vaultPath) {
    return (
      <div className="sync-panel">
        <p className="sync-panel-lead">
          Open a vault to edit the file-marker catalog. The catalog is stored in
          this vault and syncs with it.
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
        <h3 className="sync-block-title">File markers</h3>
        <p className="sync-block-desc">
          Emoji shown beside markdown files and folders in the sidebar. Stored
          as <code>.markspace/file-markers.json</code>. Notes keep a{" "}
          <code>fileMarker:</code> id from this list; folders store it on{" "}
          <code>.folder.md</code>. Right-click a note or folder → Set marker.
        </p>

        <ul className="diary-marker-settings-list">
          {draft.map((marker, index) => {
            const reorder = bindReorder(index);
            return (
              <li
                key={marker.key}
                className={`diary-marker-settings-row ${reorder.className}`.trim()}
                onDragOver={reorder.onDragOver}
                onDragLeave={reorder.onDragLeave}
                onDrop={reorder.onDrop}
              >
                <span
                  className="diary-marker-drag-handle"
                  draggable
                  onDragStart={reorder.onDragStart}
                  onDragEnd={reorder.onDragEnd}
                  aria-label="Drag to reorder"
                  title="Drag to reorder"
                >
                  ⋮⋮
                </span>
                <input
                  className="diary-marker-emoji-input"
                  type="text"
                  aria-label={`Emoji for ${marker.label || "marker"}`}
                  value={marker.emoji}
                  maxLength={MAX_FILE_MARKER_EMOJI_CHARS * 2}
                  disabled={busy}
                  spellCheck={false}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraft((rows) =>
                      rows.map((m, i) =>
                        i === index ? { ...m, emoji: value } : m,
                      ),
                    );
                  }}
                />
                <input
                  className="diary-marker-label-input"
                  type="text"
                  aria-label="Marker label"
                  placeholder="Label"
                  value={marker.label}
                  maxLength={MAX_FILE_MARKER_LABEL}
                  disabled={busy}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraft((rows) =>
                      rows.map((m, i) =>
                        i === index ? { ...m, label: value } : m,
                      ),
                    );
                  }}
                />
                <button
                  type="button"
                  className="diary-marker-remove"
                  aria-label={`Remove ${marker.label || "marker"}`}
                  disabled={busy}
                  onClick={() => {
                    if (reorder.shouldIgnoreClick()) return;
                    setDraft((rows) => rows.filter((_, i) => i !== index));
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
            No file markers. Add one, then Save.
          </p>
        )}

        <div className="sync-actions">
          <button
            type="button"
            className="sync-btn"
            disabled={busy || draft.length >= MAX_FILE_MARKERS}
            onClick={addMarker}
          >
            Add marker
          </button>
          <button
            type="button"
            className="sync-btn"
            disabled={
              busy || sameAsStored(draft, DEFAULT_FILE_MARKERS)
            }
            onClick={resetDraftToDefaults}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            className="sync-btn sync-btn-primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
        {error && <p className="embedding-model-error">{error}</p>}
      </section>
    </div>
  );
}
