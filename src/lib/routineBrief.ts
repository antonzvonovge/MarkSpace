import {
  fileToAttachment,
  type ChatAttachment,
} from "../ai/chatAttachments";
import type { ChatMode, ReasoningMode } from "../ai/types";
import { deletePath, readFileBytes, writeFileBytes } from "./vaultApi";
import type { Routine, RoutineAttachmentRef } from "./routinesApi";

export type RoutineBriefState = {
  brief: string;
  projectPath: string;
  mode: ChatMode;
  modelId: string;
  reasoningMode: ReasoningMode;
  specialistModelId: string;
  specialistsUseChatModel: boolean;
  attachments: RoutineAttachmentRef[];
};

export function routineMode(value: string | null | undefined): ChatMode {
  return value === "ask" ? "ask" : "agent";
}

export function routineReasoning(value: string | null | undefined): ReasoningMode {
  if (value === "off" || value === "on" || value === "auto") return value;
  return "auto";
}

export function briefStateFromRoutine(routine: Routine): RoutineBriefState {
  return {
    brief: routine.brief ?? "",
    projectPath: routine.projectPath ?? "",
    mode: routineMode(routine.mode),
    modelId: routine.modelId ?? "",
    reasoningMode: routineReasoning(routine.reasoningMode),
    specialistModelId: routine.specialistModelId ?? "",
    specialistsUseChatModel: routine.specialistsUseChatModel === true,
    attachments: routine.attachments ?? [],
  };
}

function safeFileStem(name: string): string {
  const cleaned = name
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 48);
  return cleaned || "file";
}

export function briefAttachmentPath(folder: string, id: string, name: string): string {
  return `${folder}/.brief-attachments/${id}-${safeFileStem(name)}`;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64ToBytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function storeBriefAttachment(
  folder: string,
  file: File,
): Promise<RoutineAttachmentRef> {
  const attachment = await fileToAttachment(file);
  if (attachment.error && !attachment.dataUrl && !attachment.textContent) {
    throw new Error(attachment.error);
  }
  const path = briefAttachmentPath(folder, attachment.id, attachment.name);
  const bytes = attachment.dataUrl
    ? dataUrlToBytes(attachment.dataUrl)
    : new TextEncoder().encode(attachment.textContent ?? "");
  if (bytes.byteLength === 0) {
    throw new Error(`${attachment.name}: empty file`);
  }
  await writeFileBytes(path, bytes, { overwrite: true });
  return {
    id: attachment.id,
    name: attachment.name,
    mediaType: attachment.mediaType,
    kind: attachment.kind,
    path,
  };
}

export async function removeBriefAttachment(path: string): Promise<void> {
  try {
    await deletePath(path);
  } catch {
    /* already gone */
  }
}

export async function loadBriefAttachment(
  ref: RoutineAttachmentRef,
): Promise<ChatAttachment> {
  try {
    const file = await readFileBytes(ref.path);
    if (ref.kind === "image") {
      const mediaType = ref.mediaType || "image/png";
      return {
        id: ref.id,
        name: ref.name,
        mediaType,
        size: file.byteLength,
        kind: "image",
        dataUrl: `data:${mediaType};base64,${file.dataBase64}`,
      };
    }
    const text = new TextDecoder().decode(base64ToBytes(file.dataBase64));
    const kind = ref.kind === "pdf" ? "pdf" : "text";
    return {
      id: ref.id,
      name: ref.name,
      mediaType: ref.mediaType || (kind === "pdf" ? "application/pdf" : "text/plain"),
      size: file.byteLength,
      kind,
      textContent: text,
    };
  } catch (err) {
    return {
      id: ref.id,
      name: ref.name,
      mediaType: ref.mediaType,
      size: 0,
      kind: ref.kind === "image" ? "image" : ref.kind === "pdf" ? "pdf" : "text",
      error: err instanceof Error ? err.message : "Could not read attachment",
    };
  }
}

export function remapAttachmentFolder(
  attachments: RoutineAttachmentRef[],
  from: string,
  to: string,
): RoutineAttachmentRef[] {
  if (!from || from === to) return attachments;
  const oldPrefix = `${from}/.brief-attachments/`;
  const nextPrefix = `${to}/.brief-attachments/`;
  return attachments.map((attachment) =>
    attachment.path.startsWith(oldPrefix)
      ? { ...attachment, path: nextPrefix + attachment.path.slice(oldPrefix.length) }
      : attachment,
  );
}
