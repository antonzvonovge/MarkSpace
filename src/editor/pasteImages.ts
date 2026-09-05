import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";

function collectImageFiles(data: DataTransfer): File[] {
  const files: File[] = [];
  const seen = new Set<string>();

  const push = (file: File | null) => {
    if (!file || file.size <= 0) return;
    if (file.type && !file.type.startsWith("image/")) return;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  if (data.files?.length) {
    for (let i = 0; i < data.files.length; i++) {
      push(data.files[i]);
    }
  }

  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/") || item.kind === "file") {
        push(item.getAsFile());
      }
    }
  }

  return files;
}

/** Images from a paste event: files/items plus `<img src="data:…">` in HTML. */
export function collectImageFilesFromPaste(data: DataTransfer): File[] {
  let files = collectImageFiles(data);
  if (files.length === 0) {
    const html = data.getData("text/html");
    if (html) files = collectImagesFromHtml(html);
  }
  return files;
}

function fileFromDataUrl(dataUrl: string, name = "image.png"): File | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return new File([bytes], name.endsWith(`.${ext}`) ? name : `image.${ext}`, {
    type: mime,
  });
}

function collectImagesFromHtml(html: string): File[] {
  const files: File[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (src.startsWith("data:image/")) {
      const file = fileFromDataUrl(src, `image-${++i}.png`);
      if (file) files.push(file);
    }
  }
  return files;
}

async function rgbaToPngFile(
  rgba: Uint8Array,
  width: number,
  height: number,
  name = "clipboard.png",
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot create canvas for clipboard image");

  const imageData = new ImageData(
    new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width,
    height,
  );
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
      "image/png",
    );
  });
  return new File([blob], name, { type: "image/png" });
}

/** Reason of the most recent failed clipboard image read, for diagnostics. */
let lastClipboardImageError: unknown = null;

async function readImagesFromTauriClipboard(): Promise<File[]> {
  try {
    const image = await readImage();
    const { width, height } = await image.size();
    if (!width || !height) return [];
    const rgba = await image.rgba();
    const file = await rgbaToPngFile(rgba, width, height);
    return [file];
  } catch (err) {
    lastClipboardImageError = err;
    return [];
  }
}

/** Browser Clipboard API (works on Windows when Tauri image read fails). */
async function readImagesFromNavigatorClipboard(): Promise<File[]> {
  try {
    if (!navigator.clipboard?.read) return [];
    const items = await navigator.clipboard.read();
    const files: File[] = [];
    let i = 0;
    for (const item of items) {
      for (const type of item.types) {
        if (!type.startsWith("image/")) continue;
        const blob = await item.getType(type);
        const ext = type.split("/")[1]?.replace("jpeg", "jpg") || "png";
        files.push(
          new File([blob], `clipboard-${++i}.${ext}`, { type }),
        );
      }
    }
    return files;
  } catch (err) {
    lastClipboardImageError = err;
    return [];
  }
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Prefer Tauri, then navigator.clipboard.read().
 *
 * On Linux the clipboard owner (screenshot tools, browsers) often serves the
 * image lazily and the first read comes back empty, so callers that know an
 * image is expected can ask for a few retries.
 */
export async function readImagesFromSystemClipboard(
  retries = 0,
): Promise<File[]> {
  lastClipboardImageError = null;
  for (let attempt = 0; ; attempt++) {
    const fromTauri = await readImagesFromTauriClipboard();
    if (fromTauri.length) return fromTauri;
    const fromNavigator = await readImagesFromNavigatorClipboard();
    if (fromNavigator.length) return fromNavigator;
    if (attempt >= retries) return [];
    await delay(60 * (attempt + 1));
  }
}

export function warnClipboardImageMissing(context: string) {
  if (lastClipboardImageError) {
    console.warn(
      `${context}: clipboard image read failed`,
      lastClipboardImageError,
    );
  } else {
    console.warn(`${context}: clipboard holds no image`);
  }
}

/**
 * Ctrl+V on a non-Latin layout is handled on keydown, before the DOM paste
 * event. Mark the gesture so the paste event — if the webview still emits one
 * despite preventDefault — does not insert the image a second time.
 */
const PASTE_GESTURE_TTL_MS = 150;
let pasteGestureAt = 0;

export function markPasteGestureHandled() {
  pasteGestureAt = Date.now();
}

export function pasteGestureAlreadyHandled(): boolean {
  return Date.now() - pasteGestureAt < PASTE_GESTURE_TTL_MS;
}

export async function readTextFromSystemClipboard(): Promise<string> {
  try {
    const text = await navigator.clipboard.readText();
    if (text) return text;
  } catch {
    /* fall through */
  }
  try {
    return (await readText()) ?? "";
  } catch {
    return "";
  }
}
