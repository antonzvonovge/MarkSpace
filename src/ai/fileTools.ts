import { tool } from "ai";
import { z } from "zod";
import {
  httpFetchBytes,
  readFileBytes,
  writeFileBytes,
} from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";
import type { ChatMode } from "./types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Cap base64 returned for non-image binaries so chat history stays usable. */
const MAX_INLINE_BASE64_CHARS = 120_000;

export type ReadFileToolResult =
  | {
      ok: true;
      source: string;
      source_kind: "url" | "vault";
      media_type: string;
      filename: string;
      byte_length: number;
      /** Present for images (vision) and small non-image binaries. */
      data_base64?: string;
      /** UTF-8 text when the file looks like text. */
      text?: string;
      text_truncated?: boolean;
      saved_path?: string;
      http_status?: number;
    }
  | { ok: false; error: string };

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function isHttpUrl(source: string): boolean {
  try {
    const u = new URL(source);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const decoded = decodeURIComponent(last).split("?")[0] ?? "";
    if (decoded && decoded !== "." && decoded !== "..") return decoded;
  } catch {
    /* fall through */
  }
  return "download.bin";
}

function filenameFromPath(path: string): string {
  const cleaned = path.trim().replace(/^\/+|\/+$/g, "");
  const last = cleaned.split("/").pop() ?? "";
  return last || "file.bin";
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0) return "";
  return name.slice(i + 1).toLowerCase();
}

function mediaTypeFromExt(ext: string): string | null {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    case "md":
      return "text/markdown";
    case "txt":
      return "text/plain";
    case "json":
      return "application/json";
    case "html":
    case "htm":
      return "text/html";
    case "css":
      return "text/css";
    case "js":
    case "mjs":
    case "cjs":
      return "text/javascript";
    case "ts":
    case "tsx":
      return "text/typescript";
    case "csv":
      return "text/csv";
    case "xml":
      return "application/xml";
    case "drawio":
      return "application/xml";
    default:
      return null;
  }
}

function sniffMediaType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function looksLikeText(mediaType: string, bytes: Uint8Array): boolean {
  if (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "application/xml" ||
    mediaType === "application/javascript" ||
    mediaType.endsWith("+json") ||
    mediaType.endsWith("+xml")
  ) {
    return true;
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  let weird = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32)) weird += 1;
  }
  return weird / Math.max(sample.length, 1) < 0.05;
}

function resolveSavePath(saveAs: string, fallbackName: string): string {
  let path = saveAs.trim().replace(/^\/+/, "");
  if (!path) throw new Error("save_as path is empty");
  if (path.endsWith("/")) {
    path = `${path}${fallbackName}`;
  }
  return path;
}

export function buildFileTools(mode: ChatMode) {
  return {
    read_file: tool({
      description:
        "Read a vault file or download an http(s) URL as bytes for analysis. Images are returned to the model as vision input. Optionally save a copy into the vault with save_as (vault-relative path, e.g. Project/.assets/logo.png or assets/shot.png). In Ask mode save_as is not allowed.",
      inputSchema: z.object({
        source: z
          .string()
          .min(1)
          .describe(
            "Vault-relative path (e.g. Notes/.assets/a.png) or http(s) URL",
          ),
        save_as: z
          .string()
          .optional()
          .describe(
            "Optional vault-relative destination path to save the bytes. Parent folders are created. If the file exists, a unique sibling name is used.",
          ),
      }),
      execute: async ({ source, save_as: saveAs }): Promise<ReadFileToolResult> => {
        try {
          if (mode === "ask" && saveAs?.trim()) {
            return {
              ok: false,
              error: "save_as is only available in Agent mode",
            };
          }

          const trimmed = source.trim();
          let dataBase64: string;
          let byteLength: number;
          let mediaTypeHint: string | null = null;
          let filename: string;
          let sourceKind: "url" | "vault";
          let httpStatus: number | undefined;

          if (isHttpUrl(trimmed)) {
            sourceKind = "url";
            filename = filenameFromUrl(trimmed);
            const res = await httpFetchBytes(trimmed);
            if (res.status < 200 || res.status >= 300) {
              return {
                ok: false,
                error: `HTTP ${res.status} fetching ${trimmed}`,
              };
            }
            dataBase64 = res.dataBase64;
            byteLength = res.byteLength;
            mediaTypeHint = res.contentType;
            httpStatus = res.status;
          } else {
            sourceKind = "vault";
            const path = trimmed.replace(/^\/+/, "");
            filename = filenameFromPath(path);
            const res = await readFileBytes(path);
            dataBase64 = res.dataBase64;
            byteLength = res.byteLength;
          }

          if (byteLength > MAX_FILE_BYTES) {
            return {
              ok: false,
              error: `File too large (${byteLength} bytes, max ${MAX_FILE_BYTES})`,
            };
          }

          const bytes = base64ToBytes(dataBase64);
          const sniffed = sniffMediaType(bytes);
          const fromExt = mediaTypeFromExt(extOf(filename));
          const mediaType =
            sniffed ||
            (mediaTypeHint && mediaTypeHint !== "application/octet-stream"
              ? mediaTypeHint
              : null) ||
            fromExt ||
            "application/octet-stream";

          let savedPath: string | undefined;
          if (saveAs?.trim()) {
            const dest = resolveSavePath(saveAs, filename);
            savedPath = await writeFileBytes(dest, bytes);
            await useVaultStore.getState().refreshTree();
          }

          const result: ReadFileToolResult = {
            ok: true,
            source: trimmed,
            source_kind: sourceKind,
            media_type: mediaType,
            filename,
            byte_length: byteLength,
            ...(httpStatus != null ? { http_status: httpStatus } : {}),
            ...(savedPath ? { saved_path: savedPath } : {}),
          };

          if (mediaType.startsWith("image/")) {
            result.data_base64 = dataBase64;
          } else if (looksLikeText(mediaType, bytes)) {
            const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
            const maxChars = 80_000;
            if (text.length > maxChars) {
              result.text = text.slice(0, maxChars);
              result.text_truncated = true;
            } else {
              result.text = text;
              result.text_truncated = false;
            }
          } else if (dataBase64.length <= MAX_INLINE_BASE64_CHARS) {
            result.data_base64 = dataBase64;
          }

          await yieldToUi();
          return result;
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      toModelOutput: ({ output }) => {
        if (!output || typeof output !== "object" || !("ok" in output)) {
          return { type: "json", value: output as never };
        }
        if (!output.ok) {
          return {
            type: "error-text",
            value: output.error,
          };
        }
        const summaryParts = [
          `Read ${output.source_kind} file "${output.filename}" (${output.media_type}, ${output.byte_length} bytes).`,
        ];
        if (output.saved_path) {
          summaryParts.push(`Saved to vault path: ${output.saved_path}`);
        }
        if (output.text != null) {
          summaryParts.push(
            output.text_truncated
              ? "Text content (truncated):"
              : "Text content:",
          );
          return {
            type: "content",
            value: [
              { type: "text", text: summaryParts.join("\n") },
              { type: "text", text: output.text },
            ],
          };
        }
        if (output.media_type.startsWith("image/") && output.data_base64) {
          return {
            type: "content",
            value: [
              { type: "text", text: summaryParts.join(" ") },
              {
                type: "file-data",
                mediaType: output.media_type,
                data: output.data_base64,
                filename: output.filename,
              },
            ],
          };
        }
        if (output.data_base64) {
          summaryParts.push(
            `Base64 payload included (${output.data_base64.length} chars).`,
          );
          return {
            type: "json",
            value: {
              ...output,
              // Keep base64 for the model when not an image.
            },
          };
        }
        summaryParts.push(
          "Binary payload omitted from model context (too large); use saved_path or a smaller file.",
        );
        return { type: "text", value: summaryParts.join(" ") };
      },
    }),
  };
}

/** @internal exported for tests */
export const _test = {
  isHttpUrl,
  filenameFromUrl,
  resolveSavePath,
  sniffMediaType,
  mediaTypeFromExt,
};
