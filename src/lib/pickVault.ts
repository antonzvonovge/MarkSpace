import { open } from "@tauri-apps/plugin-dialog";
import { saveLastVault } from "./settingsStore";
import { useVaultStore } from "../store/vaultStore";

/** Folder picker, then open that directory as the vault. */
export async function pickAndOpenVault(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open MarkSpace vault",
  });
  if (typeof selected !== "string") return;
  await useVaultStore.getState().openVaultAt(selected);
  await saveLastVault(selected);
}
