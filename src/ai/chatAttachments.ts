import type { FileUIPart, UIMessage } from "ai";

export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 100_000;
/** Rough token estimate per attached image for the context meter. */
export const IMAGE_TOKEN_ESTIMATE = 1500;

export type ChatAttachmentKind = "image" | "text" | "pdf" | "unsupported";

export type ChatAttachment = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  kind: ChatAttachmentKind;
  /** Data URL for images (and kept for save_attachment). */
  dataUrl?: string;
  /** Extracted / raw text for documents. */
  textContent?: string;
  /** Short error if the file could not be prepared. */
  error?: string;
};

const TEXT_EXTS = new Set([
  "md",
  "markdown",
  "txt",
  "json",
  "csv",
  "html",
  "htm",
  "xml",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "log",
  "sql",
  "svg",
  "env",
  "gitignore",
  "dockerfile",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function classifyAttachment(
  name: string,
  mediaType: string,
): ChatAttachmentKind {
  const mime = (mediaType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || extOf(name) === "pdf") return "pdf";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/typescript" ||
    TEXT_EXTS.has(extOf(name))
  ) {
    return "text";
  }
  return "unsupported";
}

function truncateText(text: string, max = MAX_TEXT_CHARS): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= max) return { text, truncated: false };
  return {
    text: `${text.slice(0, max)}\n\n…[truncated at ${max} characters]`,
    truncated: true,
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read file as data URL"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

async function readFileAsText(file: File): Promise<string> {
  return file.text();
}

let pdfjsLibPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then(async (pdfjs) => {
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsLibPromise;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    if (pageText.trim()) parts.push(pageText);
    if (parts.join("\n\n").length >= MAX_TEXT_CHARS) break;
  }
  return parts.join("\n\n");
}

export async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const id = crypto.randomUUID();
  const name = file.name?.trim() || "attachment";
  const mediaType = file.type || guessMediaType(name);
  const size = file.size;
  const kind = classifyAttachment(name, mediaType);

  if (size > MAX_ATTACHMENT_BYTES) {
    return {
      id,
      name,
      mediaType,
      size,
      kind,
      error: `File too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB)`,
    };
  }

  try {
    if (kind === "image") {
      const dataUrl = await fileToDataUrl(file);
      return { id, name, mediaType, size, kind, dataUrl };
    }
    if (kind === "text") {
      const raw = await readFileAsText(file);
      const { text } = truncateText(raw);
      return { id, name, mediaType, size, kind, textContent: text };
    }
    if (kind === "pdf") {
      const raw = await extractPdfText(file);
      if (!raw.trim()) {
        return {
          id,
          name,
          mediaType: mediaType || "application/pdf",
          size,
          kind,
          error: "Could not extract text from PDF",
        };
      }
      const { text } = truncateText(raw);
      return {
        id,
        name,
        mediaType: mediaType || "application/pdf",
        size,
        kind,
        textContent: text,
      };
    }
    return {
      id,
      name,
      mediaType,
      size,
      kind: "unsupported",
      error: "Unsupported file type",
    };
  } catch (e) {
    return {
      id,
      name,
      mediaType,
      size,
      kind,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function guessMediaType(name: string): string {
  const ext = extOf(name);
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "pdf") return "application/pdf";
  if (ext === "json") return "application/json";
  if (ext === "drawio") return "application/xml";
  if (TEXT_EXTS.has(ext)) return "text/plain";
  return "application/octet-stream";
}

export function mergeAttachments(
  existing: ChatAttachment[],
  incoming: ChatAttachment[],
): { next: ChatAttachment[]; rejected: string[] } {
  const rejected: string[] = [];
  const next = [...existing];
  for (const att of incoming) {
    if (next.length >= MAX_ATTACHMENTS) {
      rejected.push(`${att.name}: max ${MAX_ATTACHMENTS} attachments`);
      continue;
    }
    if (att.error && att.kind === "unsupported") {
      rejected.push(`${att.name}: ${att.error}`);
      continue;
    }
    if (att.error && !att.dataUrl && !att.textContent) {
      rejected.push(`${att.name}: ${att.error}`);
      continue;
    }
    next.push(att);
  }
  return { next, rejected };
}

export type PreparedUserParts = {
  parts: UIMessage["parts"];
  /** Human-readable title hint (text or first file name). */
  titleHint: string;
};

/** Marker prefix used when inlining text/PDF attachments for the model. */
export const ATTACHED_FILE_HEADER = "Attached file: ";

function fenceLang(name: string): string {
  const ext = extOf(name);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs")
    return "javascript";
  if (ext === "py") return "python";
  if (ext === "rs") return "rust";
  if (ext === "json") return "json";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "xml" || ext === "svg") return "xml";
  if (ext === "sql") return "sql";
  if (ext === "sh" || ext === "bash" || ext === "zsh") return "bash";
  return "";
}

/** Build UIMessage parts from draft text + attachments. */
export function prepareUserMessageParts(
  draftText: string,
  attachments: ChatAttachment[],
): PreparedUserParts {
  const usable = attachments.filter(
    (a) => !a.error || a.dataUrl || a.textContent,
  );
  const docBlocks: string[] = [];
  const imageParts: FileUIPart[] = [];
  const notes: string[] = [];

  for (const att of usable) {
    if (att.error && !att.textContent && !att.dataUrl) {
      notes.push(`[Attachment ${att.name}: ${att.error}]`);
      continue;
    }
    if (att.kind === "image" && att.dataUrl) {
      imageParts.push({
        type: "file",
        mediaType: att.mediaType || "image/png",
        filename: att.name,
        url: att.dataUrl,
      });
      continue;
    }
    if ((att.kind === "text" || att.kind === "pdf") && att.textContent) {
      const lang = att.kind === "pdf" ? "" : fenceLang(att.name);
      const header = `${ATTACHED_FILE_HEADER}${att.name}`;
      docBlocks.push(
        `${header}\n\`\`\`${lang}\n${att.textContent}\n\`\`\``,
      );
      continue;
    }
    if (att.error) {
      notes.push(`[Attachment ${att.name}: ${att.error}]`);
    }
  }

  const textPieces = [draftText.trim(), ...docBlocks, ...notes].filter(
    Boolean,
  );
  const text = textPieces.join("\n\n");
  const parts: UIMessage["parts"] = [];
  if (text) {
    parts.push({ type: "text", text });
  } else if (imageParts.length > 0) {
    parts.push({ type: "text", text: "(see attached image)" });
  }
  parts.push(...imageParts);

  const titleHint =
    draftText.trim() ||
    usable[0]?.name ||
    (imageParts[0]?.filename ?? "Attachment");

  return { parts, titleHint };
}

/**
 * User-authored text only — attachment dumps stay in stored parts for the model
 * but must not appear in the chat bubble (notes often contain ``` that break
 * fence-based stripping).
 */
export function displayTextFromUserMessage(message: UIMessage): string {
  const raw = (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
  if (!raw) return "";

  // Docs are always appended after the draft; cut from the first header.
  const headerRe = new RegExp(`(?:^|\\n)${escapeRegExp(ATTACHED_FILE_HEADER)}`);
  const attIdx = raw.search(headerRe);
  let user = attIdx >= 0 ? raw.slice(0, attIdx) : raw;

  user = user
    .replace(/\n?\[Attachment [^\]]+\]/g, "")
    .replace(/\(see attached image\)/g, "")
    .trim();
  return user;
}

/** Filenames of text/PDF attachments inlined into a user message. */
export function attachedDocNamesFromUserMessage(message: UIMessage): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(`${escapeRegExp(ATTACHED_FILE_HEADER)}([^\\n]+)`, "g");
  for (const part of message.parts ?? []) {
    if (part.type !== "text") continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(part.text))) {
      const name = m[1]!.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isFilePart(
  part: UIMessage["parts"][number],
): part is FileUIPart {
  return (
    typeof part === "object" &&
    part !== null &&
    part.type === "file" &&
    typeof (part as FileUIPart).url === "string"
  );
}

export function filePartsFromMessages(messages: UIMessage[]): FileUIPart[] {
  const out: FileUIPart[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    for (const part of msg.parts ?? []) {
      if (isFilePart(part)) out.push(part);
    }
  }
  return out;
}

/** Find a file part by filename or 1-based index among recent user file parts. */
export function findAttachmentFilePart(
  messages: UIMessage[],
  opts: { attachment_name?: string; attachment_index?: number },
): FileUIPart | null {
  const parts = filePartsFromMessages(messages);
  if (parts.length === 0) return null;

  if (opts.attachment_index != null) {
    const i = opts.attachment_index - 1;
    return parts[i] ?? null;
  }
  if (opts.attachment_name) {
    const want = opts.attachment_name.toLowerCase();
    const exact = parts.find(
      (p) => (p.filename ?? "").toLowerCase() === want,
    );
    if (exact) return exact;
    const partial = parts.find((p) =>
      (p.filename ?? "").toLowerCase().includes(want),
    );
    if (partial) return partial;
  }
  // Default: last image attachment
  return parts[parts.length - 1] ?? null;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl);
  if (!match?.[1]) throw new Error("Invalid data URL");
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function estimateAttachmentTokens(attachments: ChatAttachment[]): number {
  let total = 0;
  for (const att of attachments) {
    if (att.kind === "image") total += IMAGE_TOKEN_ESTIMATE;
    else if (att.textContent) total += Math.ceil(att.textContent.length / 4);
  }
  return total;
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
