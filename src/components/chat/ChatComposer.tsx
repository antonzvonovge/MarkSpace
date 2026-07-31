import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  formatAttachmentSize,
  type ChatAttachment,
} from "../../ai/chatAttachments";
import { estimateContextTokens } from "../../ai/estimateTokens";
import { contextWindowForModel, type AiModelOption } from "../../ai/types";
import { readImagesFromSystemClipboard } from "../../editor/pasteImages";
import {
  insertPathChip,
  isComposerVisuallyEmpty,
  renderComposerFromDraft,
  serializeComposer,
} from "../../lib/chatComposerDom";
import {
  clearVaultTreeDrag,
  isVaultTreeDrag,
  vaultPathFromDrop,
} from "../../lib/vaultTreeDrag";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useChatStore } from "../../store/chatStore";
import { ChatContextMeter } from "./ChatContextMeter";
import { ChatModelPicker } from "./ChatModelPicker";
import { ChatProjectPicker } from "./ChatProjectPicker";

const COMPOSER_INPUT_MIN_HEIGHT_PX = 28;
const COMPOSER_INPUT_MAX_HEIGHT_PX = 160;

function syncComposerInputHeight(el: HTMLElement) {
  // WebKitGTK (Tauri/Linux): while the panel still has no laid-out width,
  // an empty field reports scrollHeight near max-height. Stay at the
  // single-line size until width is real; ResizeObserver re-syncs later.
  if (isComposerVisuallyEmpty(el) || el.clientWidth <= 0) {
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

type DragKind = "vault" | "files";

export function ChatComposer() {
  const inputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState<DragKind | null>(null);
  const [attachHint, setAttachHint] = useState<string | null>(null);
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const draftAttachments = useChatStore((s) => s.draftAttachments);
  const addAttachments = useChatStore((s) => s.addAttachments);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const projectPath = useChatStore((s) => s.projectPath);
  const projectAbout = useChatStore((s) => s.projectAbout);
  const setProjectPath = useChatStore((s) => s.setProjectPath);
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
    projectPath,
    projectAbout,
    systemPromptPreview,
    streaming,
  ]);

  const limit = contextWindowForModel(settings, modelId || settings.modelId);

  const focusInput = () => {
    queueMicrotask(() => inputRef.current?.focus());
  };

  const syncDraftFromDom = () => {
    const el = inputRef.current;
    if (!el) return;
    const next = serializeComposer(el);
    setDraft(next);
    el.classList.toggle("is-empty", next.trim().length === 0);
    syncComposerInputHeight(el);
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

  const dragKindFrom = (dt: DataTransfer): DragKind | null => {
    if (isVaultTreeDrag(dt)) return "vault";
    if (Array.from(dt.types as ArrayLike<string>).includes("Files")) {
      return "files";
    }
    return null;
  };

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

  // Keep DOM in sync when draft is cleared/changed externally (send, new thread).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const current = serializeComposer(el);
    if (current !== draft) {
      renderComposerFromDraft(el, draft);
    }
    el.classList.toggle("is-empty", draft.trim().length === 0);
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
        const kind = dragKindFrom(e.dataTransfer);
        if (kind) setDragOver(kind);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (streaming) return;
        const kind = dragKindFrom(e.dataTransfer);
        if (kind) {
          setDragOver(kind);
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        setDragOver(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(null);
        if (streaming) return;
        const vaultPath = vaultPathFromDrop(e.dataTransfer);
        clearVaultTreeDrag();
        if (vaultPath) {
          const el = inputRef.current;
          if (el) {
            insertPathChip(el, vaultPath, e.clientX, e.clientY);
            syncDraftFromDom();
          }
          return;
        }
        if (e.dataTransfer.files?.length) {
          void ingestFiles(e.dataTransfer.files);
        }
      }}
    >
      {dragOver && (
        <div className="chat-composer-drop-hint" aria-hidden="true">
          {dragOver === "vault" ? "Drop to link path" : "Drop files to attach"}
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

      <div
        ref={inputRef}
        className="chat-composer-input is-empty"
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        contentEditable={!streaming}
        suppressContentEditableWarning
        data-placeholder={streaming ? "Streaming…" : "Message…"}
        onInput={() => {
          syncDraftFromDom();
        }}
        onPaste={(e) => {
          if (streaming) return;
          const data = e.clipboardData;
          if (!data) return;
          const files = collectPasteFiles(data).filter(isUsefulAttachFile);
          if (files.length > 0) {
            e.preventDefault();
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
            return;
          }
          // Plain text only — avoid pasted HTML/chrome from rich sources.
          e.preventDefault();
          const text = data.getData("text/plain");
          if (text) {
            document.execCommand("insertText", false, text);
            syncDraftFromDom();
          }
        }}
        onKeyDown={(e) => {
          if (
            (e.ctrlKey || e.metaKey) &&
            e.code === "KeyV" &&
            !e.shiftKey &&
            !e.altKey
          ) {
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
        <ChatProjectPicker
          value={projectPath}
          disabled={streaming}
          onChange={(path) => {
            void setProjectPath(path);
          }}
        />

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
