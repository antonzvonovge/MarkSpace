import { open } from "@tauri-apps/plugin-dialog";
import { FileTree } from "./FileTree";
import { loadLastVault, saveLastVault } from "../lib/settingsStore";
import { useVaultStore } from "../store/vaultStore";

export { loadLastVault, saveLastVault };

export function Sidebar() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const dirty = useVaultStore((s) => s.dirty);
  const saving = useVaultStore((s) => s.saving);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);

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

  return (
    <aside className="sidebar">
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
          <div className="vault-status">
            {saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}
          </div>
        </div>
      )}

      <FileTree />
    </aside>
  );
}
