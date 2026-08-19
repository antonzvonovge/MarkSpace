import { Image as TauriImage } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { filePathFromAssetSrc, vaultRelFromAbsolute } from "./assetUrl";
import {
  rasterizeHtmlImageToPng,
  rasterizeImageBytesToPng,
} from "./rasterizeSvg";
import { getVaultPath, httpFetchBytes, readFileBytes } from "./vaultApi";

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesFromDataUrl(src: string): Uint8Array | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(src);
  if (!match) return null;
  const payload = match[3] ?? "";
  if (match[2]) {
    try {
      return base64ToBytes(payload);
    } catch {
      return null;
    }
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return null;
  }
}

async function bytesFromVaultAsset(src: string): Promise<Uint8Array | null> {
  const abs = filePathFromAssetSrc(src);
  if (!abs) return null;
  const vault = await getVaultPath();
  if (!vault) return null;
  const rel = vaultRelFromAbsolute(abs, vault);
  if (!rel) return null;
  const file = await readFileBytes(rel);
  return base64ToBytes(file.dataBase64);
}

async function bytesFromFetch(src: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function bytesFromHttp(src: string): Promise<Uint8Array | null> {
  try {
    const res = await httpFetchBytes(src);
    if (res.status < 200 || res.status >= 300) return null;
    return base64ToBytes(res.dataBase64);
  } catch {
    return null;
  }
}

/** Original file bytes for a displayed image, avoiding a tainted canvas. */
async function bytesFromImageSrc(src: string): Promise<Uint8Array | null> {
  if (!src) return null;
  if (src.startsWith("data:")) return bytesFromDataUrl(src);

  try {
    const fromVault = await bytesFromVaultAsset(src);
    if (fromVault && fromVault.byteLength > 0) return fromVault;
  } catch {
    // fall through
  }

  if (
    src.startsWith("blob:") ||
    src.startsWith("asset:") ||
    /^https?:/i.test(src)
  ) {
    const fromFetch = await bytesFromFetch(src);
    if (fromFetch && fromFetch.byteLength > 0) return fromFetch;
  }

  if (/^https?:/i.test(src)) {
    const fromHttp = await bytesFromHttp(src);
    if (fromHttp && fromHttp.byteLength > 0) return fromHttp;
  }

  return null;
}

/**
 * PNG bytes for clipboard from a displayed <img>.
 * Vault `asset://` images cannot be read back via canvas (tainted).
 */
export async function pngBytesFromHtmlImage(
  image: HTMLImageElement,
): Promise<Uint8Array> {
  const src = image.currentSrc || image.src;
  const original = await bytesFromImageSrc(src);
  if (original && original.byteLength > 0) {
    return rasterizeImageBytesToPng(original);
  }
  return rasterizeHtmlImageToPng(image);
}

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
