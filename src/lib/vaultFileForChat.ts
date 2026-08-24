import { convertFileSrc } from "@tauri-apps/api/core";
import {
  classifyAttachment,
  guessMediaType,
} from "../ai/chatAttachments";
import { absolutePath, readNote } from "./vaultApi";

function fileNameFromVaultPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Load a vault-relative file as a browser `File` for chat attachments.
 * Text notes use read_note; binaries go through the asset protocol.
 */
export async function fileFromVaultPath(path: string): Promise<File> {
  const name = fileNameFromVaultPath(path);
  const mediaType = guessMediaType(name);
  const kind = classifyAttachment(name, mediaType);

  if (
    kind === "text" ||
    name.toLowerCase().endsWith(".drawio") ||
    name.toLowerCase().endsWith(".mdlnks") ||
    name.toLowerCase().endsWith(".mddict") ||
    name.toLowerCase().endsWith(".mdhabit") ||
    name.toLowerCase().endsWith(".mdcourse")
  ) {
    const content = await readNote(path);
    return new File([content], name, {
      type: mediaType || "text/plain",
      lastModified: Date.now(),
    });
  }

  const abs = await absolutePath(path);
  const url = convertFileSrc(abs);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Cannot read ${path} (${res.status})`);
  }
  const blob = await res.blob();
  return new File([blob], name, {
    type: blob.type || mediaType || "application/octet-stream",
    lastModified: Date.now(),
  });
}
