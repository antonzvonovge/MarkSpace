import type { BlockNoteEditor } from "@blocknote/core";
import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";

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

function insertImagePlaceholder(
  editor: BlockNoteEditor<any, any, any>,
  name: string,
): string {
  const currentBlock = editor.getTextCursorPosition().block;

  if (currentBlock.type === "paragraph" && isEmptyTextBlock(currentBlock)) {
    return editor.updateBlock(currentBlock, {
      type: "image",
      props: { name },
    }).id;
  }

  const inserted = editor.insertBlocks(
    [{ type: "image", props: { name } }],
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
}

function collectImageFiles(data: DataTransfer): File[] {
  const files: File[] = [];
  const seen = new Set<string>();

  const push = (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
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

async function readImagesFromTauriClipboard(): Promise<File[]> {
  try {
    const image = await readImage();
    const { width, height } = await image.size();
    if (!width || !height) return [];
    const rgba = await image.rgba();
    const file = await rgbaToPngFile(rgba, width, height);
    return [file];
  } catch {
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
  } catch {
    return [];
  }
}

/** Prefer Tauri, then navigator.clipboard.read(). */
export async function readImagesFromSystemClipboard(): Promise<File[]> {
  const fromTauri = await readImagesFromTauriClipboard();
  if (fromTauri.length) return fromTauri;
  return readImagesFromNavigatorClipboard();
}

let pasteInFlight = false;

async function uploadImages(
  editor: BlockNoteEditor<any, any, any>,
  imageFiles: File[],
) {
  if (!editor.uploadFile || imageFiles.length === 0 || pasteInFlight) return;
  pasteInFlight = true;
  try {
    for (const file of imageFiles) {
      const name = file.name?.trim() || "image.png";
      const blockId = insertImagePlaceholder(editor, name);
      try {
        const url = await editor.uploadFile(file, blockId);
        if (typeof url === "string") {
          editor.updateBlock(blockId, { props: { url } });
        } else if (url && typeof url === "object") {
          editor.updateBlock(blockId, url as { props?: { url?: string } });
        }
      } catch (err) {
        console.error("Failed to paste image", err);
      }
    }
  } finally {
    window.setTimeout(() => {
      pasteInFlight = false;
    }, 400);
  }
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
    editor: BlockNoteEditor<any, any, any>;
    defaultPasteHandler: (opts?: {
      prioritizeMarkdownOverHTML?: boolean;
      plainTextAsMarkdown?: boolean;
    }) => boolean | undefined;
  }): boolean | undefined => {
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
      void uploadImages(editor, imageFiles);
      return true;
    }

    const types = data ? Array.from(data.types) : [];
    const looksLikeImage = types.some(
      (t) => t === "Files" || t.startsWith("image/"),
    );

    // No files in the DOM paste event — try native clipboard image.
    // Only swallow the event when clipboard types look like an image;
    // otherwise let default text/html paste proceed (async image is a bonus).
    void (async () => {
      const fromSystem = await readImagesFromSystemClipboard();
      if (fromSystem.length) await uploadImages(editor, fromSystem);
    })();

    if (looksLikeImage) {
      return true;
    }

    return defaultPasteHandler();
  };
}

/** Ctrl/Cmd+V via physical key when the browser paste event has no image. */
export async function pasteImagesFromSystemClipboard(
  editor: BlockNoteEditor<any, any, any>,
): Promise<boolean> {
  const files = await readImagesFromSystemClipboard();
  if (!files.length) return false;
  await uploadImages(editor, files);
  return true;
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

/** Collect image/file blobs from a ClipboardEvent (files + items). */
export function collectFilesFromClipboardData(
  data: DataTransfer | null | undefined,
): File[] {
  if (!data) return [];
  return collectImageFiles(data);
}
