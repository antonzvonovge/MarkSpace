import { createNote, joinPath, writeNote } from "./vaultApi";
import { useVaultStore } from "../store/vaultStore";

const MAX_NAME_LEN = 80;

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .trim();
}

function sanitizeNameSegment(raw: string, isFile: boolean): string {
  let cleaned = raw
    .replace(/[<>:"\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (isFile) cleaned = cleaned.replace(/\.md$/i, "").trim();
  if (cleaned === "." || cleaned === "..") cleaned = "";
  if (isFile) cleaned = cleaned.slice(0, MAX_NAME_LEN).trim();
  return cleaned;
}

/** Default note name from the first heading, else the first line. */
export function suggestedNoteNameFromMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let heading: string | null = null;
  let firstLine: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^#{1,6}\s+(.+)$/.exec(trimmed);
    if (match && !heading) {
      heading = stripInlineMarkdown(match[1] ?? "");
    } else if (!firstLine) {
      firstLine = stripInlineMarkdown(trimmed);
    }
    if (heading) break;
  }
  const cleaned = sanitizeNameSegment(heading || firstLine || "", true);
  return cleaned || "Untitled";
}

/**
 * Vault-relative `.md` path for a name typed in the save dialog.
 * A bare filename goes into `projectPath` when the chat has a project;
 * a name with `/` is treated as vault-relative.
 */
export function resolveSaveChatNotePath(
  name: string,
  projectPath: string | null,
): string {
  const trimmed = name.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const parts = trimmed.split("/").filter(Boolean);
  const sanitized = parts
    .map((part, i) => sanitizeNameSegment(part, i === parts.length - 1))
    .filter(Boolean);
  if (sanitized.length === 0) sanitized.push("Untitled");
  const file = `${sanitized[sanitized.length - 1]}.md`;
  const folders = sanitized.slice(0, -1);
  const rel = [...folders, file].join("/");
  if (folders.length > 0) return rel;
  return joinPath(projectPath?.trim() || "", rel);
}

export async function saveAssistantMessageAsNote(opts: {
  name: string;
  content: string;
  projectPath: string | null;
}): Promise<string> {
  const path = resolveSaveChatNotePath(opts.name, opts.projectPath);
  const created = await createNote(path);
  const body = opts.content.endsWith("\n") ? opts.content : `${opts.content}\n`;
  await writeNote(created, body);
  const vault = useVaultStore.getState();
  await vault.refreshTree();
  await vault.openNote(created, { preview: false });
  return created;
}
