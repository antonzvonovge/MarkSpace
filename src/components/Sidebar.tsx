import { open } from "@tauri-apps/plugin-dialog";
import { FileTree } from "./FileTree";
import { loadLastVault, saveLastVault } from "../lib/settingsStore";
import { usePrefsStore } from "../store/prefsStore";
import { useVaultStore } from "../store/vaultStore";

export { loadLastVault, saveLastVault };

function SettingsGearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6.5 1.5h3l.35 1.4a4.5 4.5 0 0 1 1.35.78l1.4-.35 1.5 2.6-1.05 1a4.6 4.6 0 0 1 0 1.56l1.05 1-1.5 2.6-1.4-.35a4.5 4.5 0 0 1-1.35.78L9.5 14.5h-3l-.35-1.4a4.5 4.5 0 0 1-1.35-.78l-1.4.35-1.5-2.6 1.05-1a4.6 4.6 0 0 1 0-1.56l-1.05-1 1.5-2.6 1.4.35a4.5 4.5 0 0 1 1.35-.78L6.5 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function Sidebar() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const dirty = useVaultStore((s) => s.dirty);
  const saving = useVaultStore((s) => s.saving);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);
  const settingsOpen = usePrefsStore((s) => s.settingsOpen);
  const openSettings = usePrefsStore((s) => s.openSettings);
  const closeSettings = usePrefsStore((s) => s.closeSettings);

  const pickVault = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open MarkSpace vault",
    });
    if (typeof selected === "string") {
      await openVaultAt(selected);
      await saveLastVault(selected);
    }
  };

  const selectionLabel =
    selectedFolderPath === ""
      ? "root"
      : selectedFolderPath;

  const statusLabel = !vaultPath
    ? "No vault"
    : saving
      ? "Saving…"
      : dirty
        ? "Unsaved"
        : "Saved";

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand-block">
          <div className="brand">MarkSpace</div>
          <p className="brand-sub">Markdown vault</p>
        </div>

        <button type="button" className="primary-btn" onClick={() => void pickVault()}>
          Open folder…
        </button>

        {vaultPath && (
          <div className="vault-meta">
            <div className="vault-name" title={selectedFolderPath || vaultPath}>
              New in: {selectionLabel}
            </div>
          </div>
        )}

        <FileTree />
      </div>

      <footer className="sidebar-footer">
        <span className="sidebar-footer-status" title={statusLabel}>
          {statusLabel}
        </span>
        <button
          type="button"
          className={
            settingsOpen
              ? "sidebar-footer-btn is-active"
              : "sidebar-footer-btn"
          }
          aria-label={settingsOpen ? "Close settings" : "Open settings"}
          title="Settings (Ctrl+,)"
          onClick={() => {
            if (settingsOpen) closeSettings();
            else openSettings();
          }}
        >
          <SettingsGearIcon />
        </button>
      </footer>
    </aside>
  );
}
