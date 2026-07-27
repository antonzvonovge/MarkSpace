import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import { FileTree } from "./FileTree";
import { useVaultStore } from "../store/vaultStore";

const STORE_FILE = "settings.json";

export async function loadLastVault(): Promise<string | null> {
  const store = await Store.load(STORE_FILE);
  return (await store.get<string>("lastVault")) ?? null;
}

export async function saveLastVault(path: string): Promise<void> {
  const store = await Store.load(STORE_FILE);
  await store.set("lastVault", path);
  await store.save();
}

export function Sidebar() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const dirty = useVaultStore((s) => s.dirty);
  const saving = useVaultStore((s) => s.saving);

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

  const parts = vaultPath?.split(/[\\/]/).filter(Boolean) ?? [];
  const folderName = parts[parts.length - 1] ?? "No vault";

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
          <div className="vault-name" title={vaultPath}>
            {folderName}
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
