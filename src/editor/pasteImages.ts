import type { BlockNoteEditor } from "@blocknote/core";
import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";

type AnyEditor = BlockNoteEditor<any, any, any>;

function isEmptyTextBlock(
  block: { content?: unknown; type: string },
): boolean {
  if (!Array.isArray(block.content)) return false;
  if (block.content.length === 0) return true;
  if (
    block.content.length === 1 &&
    typeof block.content[0] === "object" &&
    block.content[0] &&
    "type" in block.content[0] &&
    (block.content[0] as { type: string }).type === "text" &&
    "text" in block.content[0] &&
    !(block.content[0] as { text: string }).text
  ) {
    return true;
  }
  return false;
}

function appendImageBlock(
  editor: AnyEditor,
  props: Record<string, unknown>,
): string | null {
  const last = editor.document[editor.document.length - 1];
  if (!last) return null;
  try {
    return editor.insertBlocks([{ type: "image", props } as any], last, "after")[0]
      .id;
  } catch (err) {
    console.error("Failed to append pasted image", err);
    return null;
  }
}

function insertImageBlock(
  editor: AnyEditor,
  props: Record<string, unknown>,
): string | null {
  let currentBlock;
  try {
    currentBlock = editor.getTextCursorPosition().block;
  } catch {
    // No text cursor (node selection, unfocused editor) — fall back to the end.
    return appendImageBlock(editor, props);
  }

  try {
    if (currentBlock.type === "paragraph" && isEmptyTextBlock(currentBlock)) {
      return editor.updateBlock(currentBlock, {
        type: "image",
        props,
      } as any).id;
    }

    const inserted = editor.insertBlocks(
      [{ type: "image", props } as any],
      currentBlock,
      "after",
    )[0];

    if (
      (currentBlock.type === "paragraph" ||
        currentBlock.type === "bulletListItem" ||
        currentBlock.type === "numberedListItem" ||
        currentBlock.type === "checkListItem") &&
      isEmptyTextBlock(currentBlock)
    ) {
      try {
        editor.removeBlocks([currentBlock]);
      } catch {
        /* keep empty block if remove fails */
      }
    }

    return inserted.id;
  } catch (err) {
    console.error("Failed to insert pasted image", err);
    return appendImageBlock(editor, props);
  }
}

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
 * Uploads run one after another so a slow write never drops a later paste.
 * Rejections are absorbed to keep the chain alive.
 */
let uploadChain: Promise<void> = Promise.resolve();

function applyUploadedUrl(
  editor: AnyEditor,
  blockId: string | null,
  name: string,
  update: unknown,
) {
  const patch =
    typeof update === "string"
      ? { props: { url: update } }
      : (update as { props?: Record<string, unknown> } | null);
  if (!patch) return;

  if (blockId && editor.getBlock(blockId)) {
    editor.updateBlock(blockId, patch as any);
    return;
  }

  // The placeholder is gone — the document was reloaded from disk mid-upload.
  insertImageBlock(editor, { name, ...(patch.props ?? {}) });
}

async function uploadImages(editor: AnyEditor, imageFiles: File[]) {
  for (const file of imageFiles) {
    const name = file.name?.trim() || "image.png";
    const blockId = insertImageBlock(editor, { name });
    try {
      const url = await editor.uploadFile!(file, blockId ?? undefined);
      applyUploadedUrl(editor, blockId, name, url);
    } catch (err) {
      console.error("Failed to paste image", err);
    }
  }
}

function queueImageUploads(editor: AnyEditor, imageFiles: File[]): boolean {
  if (!editor.uploadFile || imageFiles.length === 0) return false;
  uploadChain = uploadChain
    .catch(() => {})
    .then(() => uploadImages(editor, imageFiles));
  return true;
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

function pasteGestureAlreadyHandled(): boolean {
  return Date.now() - pasteGestureAt < PASTE_GESTURE_TTL_MS;
}

/**
 * `clipboardData` is only readable while the paste event is being dispatched,
 * so snapshot the textual flavours up front for the async image fallback.
 */
type ClipboardSnapshot = { text: string; html: string };

/** BlockNote's accepted paste flavours, minus `Files`. */
const TEXTUAL_MIME_TYPES = [
  "vscode-editor-data",
  "blocknote/html",
  "text/markdown",
  "text/html",
  "text/plain",
];

function snapshotClipboard(data: DataTransfer | null): ClipboardSnapshot {
  if (!data) return { text: "", html: "" };
  return {
    text: data.getData("text/plain") || "",
    html: data.getData("text/html") || "",
  };
}

function pasteSnapshot(editor: AnyEditor, snapshot: ClipboardSnapshot): boolean {
  if (snapshot.html) {
    editor.pasteHTML(snapshot.html);
    return true;
  }
  if (snapshot.text) {
    editor.pasteText(snapshot.text);
    return true;
  }
  return false;
}

/**
 * BlockNote prefers text/html over Files. On Linux/Tauri the paste event often
 * has no image files — fall back to the clipboard-manager plugin.
 */
export function createImagePasteHandler() {
  return ({
    event,
    editor,
    defaultPasteHandler,
  }: {
    event: ClipboardEvent;
    editor: AnyEditor;
    defaultPasteHandler: (opts?: {
      prioritizeMarkdownOverHTML?: boolean;
      plainTextAsMarkdown?: boolean;
    }) => boolean | undefined;
  }): boolean | undefined => {
    if (pasteGestureAlreadyHandled()) return true;

    const data = event.clipboardData;
    if (!editor.uploadFile) {
      return defaultPasteHandler();
    }

    let imageFiles = data ? collectImageFiles(data) : [];

    if (imageFiles.length === 0 && data) {
      const html = data.getData("text/html");
      if (html) imageFiles = collectImagesFromHtml(html);
    }

    if (imageFiles.length > 0) {
      queueImageUploads(editor, imageFiles);
      return true;
    }

    const types = data ? Array.from(data.types) : [];
    const looksLikeImage = types.some(
      (t) => t === "Files" || t.startsWith("image/"),
    );

    // Text is right there — paste it and skip the native clipboard round-trip,
    // otherwise an image+text clipboard would be inserted twice.
    if (!looksLikeImage && types.some((t) => TEXTUAL_MIME_TYPES.includes(t))) {
      return defaultPasteHandler();
    }

    const snapshot = snapshotClipboard(data);

    // No usable payload in the DOM event — read the native clipboard instead.
    // The event is swallowed, so replay the snapshot if no image shows up.
    void (async () => {
      const fromSystem = await readImagesFromSystemClipboard(2);
      if (fromSystem.length) {
        queueImageUploads(editor, fromSystem);
        return;
      }
      if (!pasteSnapshot(editor, snapshot)) {
        warnClipboardImageMissing("Paste");
      }
    })();

    return true;
  };
}

/** Ctrl/Cmd+V via physical key when the browser paste event has no image. */
export async function pasteImagesFromSystemClipboard(
  editor: AnyEditor,
  retries = 0,
): Promise<boolean> {
  const files = await readImagesFromSystemClipboard(retries);
  return queueImageUploads(editor, files);
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
