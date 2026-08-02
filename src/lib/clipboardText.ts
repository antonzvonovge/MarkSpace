import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Write plain text to the system clipboard (Tauri, then browser fallback). */
export async function writeClipboardText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}
