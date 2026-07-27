import { usePrefsStore } from "../store/prefsStore";
import { useSyncStore } from "../store/syncStore";
import { useVaultStore } from "../store/vaultStore";

const NO_CONFLICTS: string[] = [];

export function SyncConflictBanner() {
  const conflicted = useSyncStore(
    (s) => s.status?.conflicted ?? NO_CONFLICTS,
  );
  const openSettings = usePrefsStore((s) => s.openSettings);
  const openNote = useVaultStore((s) => s.openNote);
  const settingsOpen = usePrefsStore((s) => s.settingsOpen);

  if (conflicted.length === 0 || settingsOpen) return null;

  return (
    <div className="sync-conflict-banner" role="alert">
      <div className="sync-conflict-banner-text">
        <strong>Sync conflicts</strong>
        <span>
          {conflicted.length === 1
            ? conflicted[0]
            : `${conflicted.length} files need resolution`}
        </span>
      </div>
      <div className="sync-conflict-banner-actions">
        {conflicted[0] && (
          <button
            type="button"
            className="sync-btn"
            onClick={() => void openNote(conflicted[0], { preview: false })}
          >
            Open file
          </button>
        )}
        <button
          type="button"
          className="sync-btn sync-btn-primary"
          onClick={() => openSettings("sync")}
        >
          Resolve in Settings
        </button>
      </div>
    </div>
  );
}
