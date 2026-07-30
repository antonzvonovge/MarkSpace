import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  formatAttachmentSize,
  type ChatAttachment,
} from "../../ai/chatAttachments";
import { estimateContextTokens } from "../../ai/estimateTokens";
import { contextWindowForModel, type AiModelOption } from "../../ai/types";
import { readImagesFromSystemClipboard } from "../../editor/pasteImages";
import { fileFromVaultPath } from "../../lib/vaultFileForChat";
import {
  clearVaultTreeDrag,
  isVaultTreeDrag,
  vaultPathFromDrop,
} from "../../lib/vaultTreeDrag";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useChatStore } from "../../store/chatStore";
import { ChatContextMeter } from "./ChatContextMeter";
import { ChatModelPicker } from "./ChatModelPicker";

const COMPOSER_INPUT_MIN_HEIGHT_PX = 28;
const COMPOSER_INPUT_MAX_HEIGHT_PX = 160;

function syncComposerInputHeight(el: HTMLTextAreaElement) {
  // WebKitGTK (Tauri/Linux): while the panel still has no laid-out width,
  // an empty textarea reports scrollHeight near max-height (~156px). Stay at
  // the single-line size until width is real; ResizeObserver re-syncs later.
  if (!el.value || el.clientWidth <= 0) {
    el.style.height = `${COMPOSER_INPUT_MIN_HEIGHT_PX}px`;
    el.style.overflowY = "hidden";
    return;
  }

  el.style.height = "0px";
  el.style.overflowY = "hidden";
  const contentHeight = Math.max(el.scrollHeight, COMPOSER_INPUT_MIN_HEIGHT_PX);
  const next = Math.min(contentHeight, COMPOSER_INPUT_MAX_HEIGHT_PX);
  el.style.height = `${next}px`;
  el.style.overflowY =
    contentHeight > COMPOSER_INPUT_MAX_HEIGHT_PX ? "auto" : "hidden";
}

function kindLabel(kind: ChatAttachment["kind"]): string {
  if (kind === "image") return "Image";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "Text";
  return "File";
}

/** Files from clipboardData.files + items (Windows often only fills items). */
function collectPasteFiles(data: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null | undefined) => {
    if (!file || file.size <= 0) return;
    const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  if (data.files?.length) {
    for (let i = 0; i < data.files.length; i++) push(data.files[i]);
  }
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" || item.type.startsWith("image/")) {
        push(item.getAsFile());
      }
    }
  }
  return out;
}

function isUsefulAttachFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    file.type.startsWith("text/") ||
    file.size > 0
  );
}

export function ChatComposer() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [attachHint, setAttachHint] = useState<string | null>(null);
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const draftAttachments = useChatStore((s) => s.draftAttachments);
  const addAttachments = useChatStore((s) => s.addAttachments);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const modelId = useChatStore((s) => s.modelId);
  const setModelId = useChatStore((s) => s.setModelId);
  const status = useChatStore((s) => s.status);
  const messages = useChatStore((s) => s.messages);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const systemPromptPreview = useChatStore((s) => s.systemPromptPreview);
  const settings = useAiSettingsStore((s) => s.settings);

  const streaming = status === "streaming";
  const canSend =
    !streaming && (draft.trim().length > 0 || draftAttachments.length > 0);
  const models: AiModelOption[] = settings.models.length
    ? settings.models
    : [];

  const modelOptions = useMemo(() => {
    if (!modelId || models.some((m) => m.id === modelId)) return models;
    return [
      {
        id: modelId,
        label: modelId,
        vendor: "openai" as const,
        kind: "chat" as const,
      },
      ...models,
    ];
  }, [models, modelId]);

  const usedFrozenRef = useRef(0);
  const wasStreamingRef = useRef(false);
  const used = useMemo(() => {
    if (streaming && wasStreamingRef.current) return usedFrozenRef.current;
    wasStreamingRef.current = streaming;
    const next = estimateContextTokens({
      system: systemPromptPreview(),
      messages,
      draft: streaming ? "" : draft,
      draftAttachments: streaming ? [] : draftAttachments,
      toolOverhead: mode === "agent" ? 1200 : 900,
    });
    usedFrozenRef.current = next;
    return next;
  }, [
    messages,
    draft,
    draftAttachments,
    mode,
    systemPromptPreview,
    streaming,
  ]);

  const limit = contextWindowForModel(settings, modelId || settings.modelId);

  const focusInput = () => {
    queueMicrotask(() => inputRef.current?.focus());
  };

  const ingestFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.size > 0);
    if (list.length === 0) return;
    const rejected = await addAttachments(list);
    if (rejected.length > 0) {
      setAttachHint(rejected.slice(0, 3).join(" · "));
      window.setTimeout(() => setAttachHint(null), 4000);
    } else {
      setAttachHint(null);
    }
  };

  const ingestVaultPath = async (path: string) => {
    try {
      const file = await fileFromVaultPath(path);
      await ingestFiles([file]);
    } catch (e) {
      setAttachHint(
        e instanceof Error ? e.message : `Cannot attach ${path}`,
      );
      window.setTimeout(() => setAttachHint(null), 4000);
    }
  };

  const isAttachDrag = (dt: DataTransfer) =>
    Array.from(dt.types as ArrayLike<string>).includes("Files") ||
    isVaultTreeDrag(dt);

  const clipboardImageInFlight = useRef(false);
  const tryAttachClipboardImages = async () => {
    if (streaming || clipboardImageInFlight.current) return;
    clipboardImageInFlight.current = true;
    try {
      const images = await readImagesFromSystemClipboard();
      if (images.length) await ingestFiles(images);
    } finally {
      window.setTimeout(() => {
        clipboardImageInFlight.current = false;
      }, 400);
    }
  };

  const handleSend = () => {
    if (!canSend) return;
    void send();
    focusInput();
  };

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    syncComposerInputHeight(el);
    const ro = new ResizeObserver(() => {
      syncComposerInputHeight(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draft]);

  return (
    <div
      className={
        dragOver ? "chat-composer is-drag-over" : "chat-composer"
      }
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (streaming) return;
        if (isAttachDrag(e.dataTransfer)) setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (streaming) return;
        if (isAttachDrag(e.dataTransfer)) {
          setDragOver(true);
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (streaming) return;
        const vaultPath = vaultPathFromDrop(e.dataTransfer);
        clearVaultTreeDrag();
        if (vaultPath) {
          void ingestVaultPath(vaultPath);
          return;
        }
        if (e.dataTransfer.files?.length) {
          void ingestFiles(e.dataTransfer.files);
        }
      }}
    >
      {dragOver && (
        <div className="chat-composer-drop-hint" aria-hidden="true">
          Drop files to attach
        </div>
      )}

      {draftAttachments.length > 0 && (
        <ul className="chat-attach-list" aria-label="Attachments">
          {draftAttachments.map((att) => (
            <li
              key={att.id}
              className={
                att.error
                  ? "chat-attach-chip has-error"
                  : "chat-attach-chip"
              }
            >
              {att.kind === "image" && att.dataUrl ? (
                <img
                  className="chat-attach-thumb"
                  src={att.dataUrl}
                  alt=""
                />
              ) : (
                <span className="chat-attach-kind">{kindLabel(att.kind)}</span>
              )}
              <span className="chat-attach-meta">
                <span className="chat-attach-name" title={att.name}>
                  {att.name}
                </span>
                <span className="chat-attach-size">
                  {att.error ?? formatAttachmentSize(att.size)}
                </span>
              </span>
              <button
                type="button"
                className="chat-attach-remove"
                disabled={streaming}
                onClick={() => removeAttachment(att.id)}
                title="Remove"
                aria-label={`Remove ${att.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {attachHint && (
        <div className="chat-attach-hint" role="status">
          {attachHint}
        </div>
      )}

      <textarea
        ref={inputRef}
        className="chat-composer-input"
        rows={1}
        placeholder={streaming ? "Streaming…" : "Message…"}
        value={draft}
        disabled={streaming}
        onChange={(e) => {
          setDraft(e.target.value);
          syncComposerInputHeight(e.target);
        }}

        onPaste={(e) => {
          if (streaming) return;
          const data = e.clipboardData;
          if (!data) return;
          const files = collectPasteFiles(data).filter(isUsefulAttachFile);
          if (files.length > 0) {
            e.preventDefault();
            // Block the deferred KeyV clipboard read so we don't double-attach.
            clipboardImageInFlight.current = true;
            void ingestFiles(files).finally(() => {
              window.setTimeout(() => {
                clipboardImageInFlight.current = false;
              }, 400);
            });
            return;
          }
          const types = Array.from(data.types);
          if (
            types.some((t) => t === "Files" || t.startsWith("image/"))
          ) {
            e.preventDefault();
            void tryAttachClipboardImages();
          }
        }}
        onKeyDown={(e) => {
          if (
            (e.ctrlKey || e.metaKey) &&
            e.code === "KeyV" &&
            !e.shiftKey &&
            !e.altKey
          ) {
            // Defer so onPaste can claim files first; then try system clipboard
            // (Tauri/Windows often omit image blobs from the paste event).
            window.setTimeout(() => {
              void tryAttachClipboardImages();
            }, 0);
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <div className="chat-composer-toolbar">
        <div className="chat-mode-switch" role="group" aria-label="Chat mode">
          <button
            type="button"
            className={mode === "ask" ? "is-active" : ""}
            onClick={() => setMode("ask")}
            disabled={streaming}
          >
            Ask
          </button>
          <button
            type="button"
            className={mode === "agent" ? "is-active" : ""}
            onClick={() => setMode("agent")}
            disabled={streaming}
          >
            Agent
          </button>
        </div>

        <ChatModelPicker
          models={modelOptions}
          value={modelId}
          disabled={streaming}
          onChange={setModelId}
        />

        <ChatContextMeter used={used} limit={limit} />

        <div className="chat-composer-spacer" />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="chat-attach-input"
          accept="image/*,.pdf,.md,.txt,.json,.csv,.html,.xml,.css,.js,.ts,.tsx,.py,.rs,.yaml,.yml,.toml"
          disabled={streaming}
          onChange={(e) => {
            const files = e.target.files;
            if (files) void ingestFiles(files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="chat-attach-btn"
          disabled={streaming}
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
          aria-label="Attach files"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M4.5 2.5a3 3 0 0 0-3 3v5a4.5 4.5 0 0 0 9 0V5a2 2 0 1 0-4 0v5.5a.75.75 0 0 0 1.5 0V5a.5.5 0 0 1 1 0v5.5a3 3 0 1 1-6 0v-5a1.5 1.5 0 0 1 3 0v5.5a.75.75 0 0 0 1.5 0V5a3 3 0 0 0-3-3z"
            />
          </svg>
        </button>

        {streaming ? (
          <button
            type="button"
            className="chat-send-btn is-stop"
            onClick={() => {
              stop();
              focusInput();
            }}
            title="Stop"
            aria-label="Stop"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="2" y="2" width="8" height="8" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!canSend}
            title="Send"
            aria-label="Send"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M1.5 1.5l13 6.5-13 6.5V9.5L10 8 1.5 6.5V1.5z"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
