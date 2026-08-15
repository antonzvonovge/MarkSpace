import { Image as TauriImage } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";

/** Write PNG bytes to the system clipboard (Tauri, then browser fallback). */
export async function writeClipboardPng(png: Uint8Array): Promise<void> {
  try {
    const clipboardImage = await TauriImage.fromBytes(png);
    try {
      await writeImage(clipboardImage);
    } finally {
      await clipboardImage.close();
    }
    return;
  } catch {
    if (!navigator.clipboard?.write) {
      throw new Error("Clipboard image write is unavailable");
    }
    // Copy into a plain ArrayBuffer-backed Uint8Array — ClipboardItem rejects SharedArrayBuffer views.
    const copy = new Uint8Array(png.byteLength);
    copy.set(png);
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": new Blob([copy], { type: "image/png" }) }),
    ]);
  }
}
