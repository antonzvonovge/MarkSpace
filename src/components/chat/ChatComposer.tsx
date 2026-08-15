import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  formatAttachmentSize,
  type ChatAttachment,
} from "../../ai/chatAttachments";
import { estimateUsedContext, wouldExceedContext } from "../../ai/estimateTokens";
import { listChatTools } from "../../ai/toolCatalog";
import { contextWindowForModel, type AiModelOption } from "../../ai/types";
import {
  readImagesFromSystemClipboard,
  readTextFromSystemClipboard,
} from "../../editor/pasteImages";
import {
  chipLabelForPath,
  focusComposerEnd,
  getComposerAtQuery,
  getComposerSlashQuery,
  insertPathChip,
  insertSkillChip,
  isComposerVisuallyEmpty,
  renderComposerFromDraft,
  replaceAtWithToolChip,
  replaceSlashWithSkillChip,
  serializeComposer,
} from "../../lib/chatComposerDom";
import { expandSelectionMarkers } from "../../lib/chatSelectionChips";
import { writeClipboardText } from "../../lib/clipboardText";
import {
  clearVaultTreeDrag,
  isVaultTreeDrag,
  vaultPathFromDrop,
} from "../../lib/vaultTreeDrag";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useChatStore } from "../../store/chatStore";
import { isFileTab, useVaultStore } from "../../store/vaultStore";
import {
  EditContextMenu,
  type EditContextMenuState,
} from "../EditContextMenu";
import { ChatContextMeter } from "./ChatContextMeter";
import { ChatModePicker } from "./ChatModePicker";
import { ChatModelPicker } from "./ChatModelPicker";
import { ChatProjectPicker } from "./ChatProjectPicker";
import { ChatSkillSlashMenu } from "./ChatSkillSlashMenu";
import { ReasoningToggle } from "./ReasoningToggle";
import { TerminalAutoAllowChip } from "./TerminalAutoAllowChip";
import { modelSupportsReasoning } from "../../ai/models";

/** Selected text if the selection is inside `el`, otherwise "". */
function selectionTextIn(el: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return "";
  return sel.toString();
}

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
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const slashRangeRef = useRef<Range | null>(null);
  const atRangeRef = useRef<Range | null>(null);
  const [dragOver, setDragOver] = useState<DragKind | null>(null);
  const [attachHint, setAttachHint] = useState<string | null>(null);
  const [slashMenu, setSlashMenu] = useState<{
    query: string;
    rect: DOMRect;
  } | null>(null);
  const [atMenu, setAtMenu] = useState<{
    query: string;
    rect: DOMRect;
  } | null>(null);
  const [skillPickerRect, setSkillPickerRect] = useState<DOMRect | null>(
    null,
  );
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const draftAttachments = useChatStore((s) => s.draftAttachments);
  const draftSelections = useChatStore((s) => s.draftSelections);
  const addAttachments = useChatStore((s) => s.addAttachments);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const projectPath = useChatStore((s) => s.projectPath);
  const projectAbout = useChatStore((s) => s.projectAbout);
  const projectType = useChatStore((s) => s.projectType);
  const projectLearningLanguage = useChatStore((s) => s.projectLearningLanguage);
  const setProjectPath = useChatStore((s) => s.setProjectPath);
  const modelId = useChatStore((s) => s.modelId);
  const setModelId = useChatStore((s) => s.setModelId);
  const enableReasoning = useChatStore((s) => s.enableReasoning);
  const setEnableReasoning = useChatStore((s) => s.setEnableReasoning);
  const terminalAllowForChat = useChatStore((s) => s.terminalAllowForChat);
  const setTerminalAllowForChat = useChatStore((s) => s.setTerminalAllowForChat);
  const status = useChatStore((s) => s.status);
  const messages = useChatStore((s) => s.messages);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const systemPromptPreview = useChatStore((s) => s.systemPromptPreview);
  const skillsCatalog = useChatStore((s) => s.skillsCatalog);
  const refreshSkillsCatalog = useChatStore((s) => s.refreshSkillsCatalog);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const clearThreadAttention = useChatStore((s) => s.clearThreadAttention);
  const contextAnchorTokens = useChatStore((s) => s.contextAnchorTokens);
  const contextAnchorMessageCount = useChatStore(
    (s) => s.contextAnchorMessageCount,
  );
  const settings = useAiSettingsStore((s) => s.settings);
  const activePath = useVaultStore((s) => s.activePath);
  const tabs = useVaultStore((s) => s.tabs);
  const activeFilePath = useMemo(() => {
    if (!activePath) return null;
    const tab = tabs.find((t) => t.path === activePath);
    return tab && isFileTab(tab) ? activePath : null;
  }, [activePath, tabs]);

  const streaming = status === "streaming" || status === "compacting";
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
    const next = estimateUsedContext({
      system: systemPromptPreview(),
      messages,
      draft: streaming ? "" : expandSelectionMarkers(draft, draftSelections),
      draftAttachments: streaming ? [] : draftAttachments,
      mode,
      anchor:
        contextAnchorTokens != null && contextAnchorMessageCount != null
          ? {
              tokens: contextAnchorTokens,
              messageCount: contextAnchorMessageCount,
            }
          : null,
    });
    usedFrozenRef.current = next;
    return next;
  }, [
    messages,
    draft,
    draftAttachments,
    draftSelections,
    mode,
    projectPath,
    projectAbout,
    projectType,
    projectLearningLanguage,
    skillsCatalog,
    systemPromptPreview,
    streaming,
    contextAnchorTokens,
    contextAnchorMessageCount,
  ]);

  const limit = contextWindowForModel(settings, modelId || settings.modelId);
  const contextBlocked = wouldExceedContext(used, limit);
  const canSend =
    !streaming &&
    (draft.trim().length > 0 || draftAttachments.length > 0);

  const skillMenuOpen =
    slashMenu != null || skillPickerRect != null || atMenu != null;

  const toolsCatalog = useMemo(() => listChatTools(mode), [mode]);

  const focusInput = () => {
    queueMicrotask(() => inputRef.current?.focus());
  };

  const closeSkillMenus = () => {
    slashRangeRef.current = null;
    atRangeRef.current = null;
    setSlashMenu(null);
    setAtMenu(null);
    setSkillPickerRect(null);
  };

  const syncMentionMenus = () => {
    const el = inputRef.current;
    if (!el || streaming) {
      closeSkillMenus();
      return;
    }
    const slash = getComposerSlashQuery(el);
    if (slash) {
      slashRangeRef.current = slash.range.cloneRange();
      atRangeRef.current = null;
      setAtMenu(null);
      setSkillPickerRect(null);
      setSlashMenu({
        query: slash.query,
        rect: slash.range.getBoundingClientRect(),
      });
      void refreshSkillsCatalog();
      return;
    }
    const at = getComposerAtQuery(el);
    if (at) {
      atRangeRef.current = at.range.cloneRange();
      slashRangeRef.current = null;
      setSlashMenu(null);
      setSkillPickerRect(null);
      setAtMenu({
        query: at.query,
        rect: at.range.getBoundingClientRect(),
      });
      return;
    }
    slashRangeRef.current = null;
    atRangeRef.current = null;
    setSlashMenu(null);
    setAtMenu(null);
  };

  const applySkillChipFromSlash = (id: string) => {
    const el = inputRef.current;
    if (!el) return;
    replaceSlashWithSkillChip(el, id, slashRangeRef.current);
    closeSkillMenus();
    syncDraftFromDom();
    focusInput();
  };

  const applySkillChipInsert = (id: string) => {
    const el = inputRef.current;
    if (!el) return;
    insertSkillChip(el, id);
    closeSkillMenus();
    syncDraftFromDom();
    focusInput();
  };

  const applyToolChipFromAt = (id: string) => {
    const el = inputRef.current;
    if (!el) return;
    replaceAtWithToolChip(el, id, atRangeRef.current);
    closeSkillMenus();
    syncDraftFromDom();
    focusInput();
  };

  const applyActiveFileChip = () => {
    const el = inputRef.current;
    const path = useVaultStore.getState().activePath;
    if (!el || !path) return;
    const tab = useVaultStore.getState().tabs.find((t) => t.path === path);
    if (!tab || !isFileTab(tab)) return;
    insertPathChip(el, path);
    closeSkillMenus();
    syncDraftFromDom();
    focusInput();
  };

  const plusFooterActions = useMemo(
    () =>
      skillPickerRect
        ? [
            {
              id: "active-file",
              label: "Add current file",
              description: activeFilePath
                ? chipLabelForPath(activeFilePath)
                : "No file open",
              title: activeFilePath ?? undefined,
              disabled: !activeFilePath,
            },
          ]
        : undefined,
    [skillPickerRect, activeFilePath],
  );

  const openSkillPicker = () => {
    if (streaming) return;
    const btn = plusBtnRef.current;
    if (!btn) return;
    slashRangeRef.current = null;
    atRangeRef.current = null;
    setSlashMenu(null);
    setAtMenu(null);
    setSkillPickerRect(btn.getBoundingClientRect());
    void refreshSkillsCatalog();
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

  const showDropHint = (kind: DragKind) => {
    setDragOver((prev) => (prev === kind ? prev : kind));
  };

  const hideDropHint = () => setDragOver(null);

  useEffect(() => {
    if (!dragOver) return;
    const onDragOver = (event: DragEvent) => {
      const root = composerRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setDragOver(null);
    };
    const onDragEnd = () => setDragOver(null);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, [dragOver]);

  const clipboardImageInFlight = useRef(false);
  const [contextMenu, setContextMenu] = useState<EditContextMenuState | null>(
    null,
  );
  /** Survives menu close (button focus clears the live DOM selection). */
  const pendingEditRef = useRef<{ text: string; range: Range | null }>({
    text: "",
    range: null,
  });
  const tryAttachClipboardImages = async () => {
    if (streaming || clipboardImageInFlight.current) return;
    clipboardImageInFlight.current = true;
    try {
      const images = await readImagesFromSystemClipboard(2);
      if (images.length) await ingestFiles(images);
    } finally {
      window.setTimeout(() => {
        clipboardImageInFlight.current = false;
      }, 400);
    }
  };

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openComposerContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      if (streaming) return;
      e.preventDefault();
      e.stopPropagation();
      const el = inputRef.current;
      const selected = el ? selectionTextIn(el) : "";
      const sel = window.getSelection();
      pendingEditRef.current = {
        text: selected,
        range:
          selected && sel && sel.rangeCount > 0
            ? sel.getRangeAt(0).cloneRange()
            : null,
      };
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        canCut: selected.length > 0,
        canCopy: selected.length > 0,
        canPaste: true,
      });
    },
    [streaming],
  );

  const restorePendingRange = () => {
    const { range } = pendingEditRef.current;
    const el = inputRef.current;
    if (!range || !el) return;
    el.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const cutComposerSelection = useCallback(async () => {
    if (streaming) return;
    const { text, range } = pendingEditRef.current;
    if (!text) return;
    await writeClipboardText(text);
    if (range && inputRef.current) {
      restorePendingRange();
      range.deleteContents();
      syncDraftFromDom();
    }
    pendingEditRef.current = { text: "", range: null };
  }, [streaming]);

  const copyComposerSelection = useCallback(async () => {
    const { text } = pendingEditRef.current;
    if (!text) return;
    await writeClipboardText(text);
  }, []);

  const pasteIntoComposer = useCallback(async () => {
    if (streaming) return;
    restorePendingRange();
    if (!pendingEditRef.current.range) inputRef.current?.focus();
    const images = await readImagesFromSystemClipboard(2);
    if (images.length) {
      await ingestFiles(images);
      pendingEditRef.current = { text: "", range: null };
      return;
    }
    const text = await readTextFromSystemClipboard();
    if (text) {
      document.execCommand("insertText", false, text);
      syncDraftFromDom();
    }
    pendingEditRef.current = { text: "", range: null };
  }, [streaming]);

  const handleSend = () => {
    if (!canSend) return;
    void send();
    focusInput();
  };

  // Keep DOM in sync when draft is cleared/changed externally (send, new
  // thread, selection chip added from the editor).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const current = serializeComposer(el);
    if (current !== draft) {
      renderComposerFromDraft(el, draft, (id) => draftSelections[id]);
    }
    el.classList.toggle("is-empty", draft.trim().length === 0);
    syncComposerInputHeight(el);
    const ro = new ResizeObserver(() => {
      syncComposerInputHeight(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draft, draftSelections]);

  // A selection chip arrives from the editor: take the caret so the user can
  // start typing the question right away.
  const selectionCount = Object.keys(draftSelections).length;
  const prevSelectionCount = useRef(selectionCount);
  useEffect(() => {
    const grew = selectionCount > prevSelectionCount.current;
    prevSelectionCount.current = selectionCount;
    const el = inputRef.current;
    if (!grew || streaming || !el) return;
    focusComposerEnd(el);
  }, [selectionCount, streaming]);

  // New / empty chat (New chat, Gem, open empty tab): focus the composer.
  useEffect(() => {
    if (!activeThreadId || streaming || messages.length > 0) return;
    const t = window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      focusComposerEnd(el);
    }, 0);
    return () => window.clearTimeout(t);
  }, [activeThreadId, messages.length, streaming]);

  return (
    <div
      ref={composerRef}
      className={
        dragOver ? "chat-composer is-drag-over" : "chat-composer"
      }
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (streaming) return;
        const kind = dragKindFrom(e.dataTransfer);
        if (kind) showDropHint(kind);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (streaming) return;
        const kind = dragKindFrom(e.dataTransfer);
        if (kind) {
          showDropHint(kind);
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        hideDropHint();
        if (streaming) return;
        const vaultPath = vaultPathFromDrop(e.dataTransfer);
        clearVaultTreeDrag();
        if (vaultPath) {
          const el = inputRef.current;
          if (el) {
            insertPathChip(el, vaultPath, e.clientX, e.clientY);
            syncDraftFromDom();
            focusInput();
          }
          return;
        }
        if (e.dataTransfer.files?.length) {
          void ingestFiles(e.dataTransfer.files);
        }
      }}
    >
      <div
        className={
          dragOver
            ? "chat-composer-drop-hint is-visible"
            : "chat-composer-drop-hint"
        }
        aria-hidden="true"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        }}
      >
        {dragOver === "files" ? "Drop files to attach" : "Drop to link path"}
      </div>

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
        spellCheck={false}
        suppressContentEditableWarning
        data-placeholder={streaming ? "Streaming…" : "Message…"}
        onFocus={() => {
          if (activeThreadId) clearThreadAttention(activeThreadId);
        }}
        onContextMenu={openComposerContextMenu}
        onInput={() => {
          syncDraftFromDom();
          syncMentionMenus();
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
          if (skillMenuOpen && e.key === "Enter" && !e.shiftKey) {
            // ChatSkillSlashMenu handles Enter in capture phase.
            e.preventDefault();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      {atMenu ? (
        <ChatSkillSlashMenu
          items={toolsCatalog}
          query={atMenu.query}
          prefix="@"
          limit={10}
          ariaLabel="Tools"
          emptyNoItems="No tools available"
          emptyNoMatch="No matching tools"
          anchorRect={atMenu.rect}
          onClose={closeSkillMenus}
          onSelect={applyToolChipFromAt}
        />
      ) : null}
      {slashMenu != null || skillPickerRect != null ? (
        <ChatSkillSlashMenu
          items={skillsCatalog}
          query={slashMenu?.query ?? ""}
          anchorRect={slashMenu?.rect ?? skillPickerRect}
          excludeCloseRef={plusBtnRef}
          onClose={closeSkillMenus}
          onSelect={
            slashMenu ? applySkillChipFromSlash : applySkillChipInsert
          }
          footerActions={plusFooterActions}
          onFooterSelect={(id) => {
            if (id === "active-file") applyActiveFileChip();
          }}
        />
      ) : null}
      {contextMenu ? (
        <EditContextMenu
          menu={contextMenu}
          onClose={closeContextMenu}
          onCut={() => void cutComposerSelection()}
          onCopy={() => void copyComposerSelection()}
          onPaste={() => void pasteIntoComposer()}
        />
      ) : null}
      <div className="chat-composer-toolbar">
        <ChatProjectPicker
          value={projectPath}
          disabled={streaming}
          onChange={(path) => {
            void setProjectPath(path);
          }}
        />

        <ChatModePicker
          value={mode}
          disabled={streaming}
          onChange={setMode}
        />

        <ChatModelPicker
          models={modelOptions}
          value={modelId}
          disabled={streaming}
          onChange={setModelId}
        />

        <ReasoningToggle
          supported={modelSupportsReasoning(modelId, modelOptions)}
          value={enableReasoning}
          disabled={streaming}
          onChange={setEnableReasoning}
        />

        <TerminalAutoAllowChip
          visible={
            settings.agentTerminalEnabled &&
            mode === "agent" &&
            terminalAllowForChat
          }
          disabled={streaming}
          onRevoke={() => setTerminalAllowForChat(false)}
        />

        <ChatContextMeter
          used={used}
          limit={limit}
          willCompactOnSend={contextBlocked && !streaming}
        />

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
          ref={plusBtnRef}
          type="button"
          className={
            skillPickerRect
              ? "chat-attach-btn is-active"
              : "chat-attach-btn"
          }
          disabled={streaming}
          onMouseDown={(e) => {
            // Keep the composer caret so the skill chip inserts in place.
            e.preventDefault();
          }}
          onClick={() => {
            if (skillPickerRect) closeSkillMenus();
            else openSkillPicker();
          }}
          title="Add skill or file"
          aria-label="Add skill or file"
          aria-expanded={skillPickerRect != null}
          aria-haspopup="listbox"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 2.5a.75.75 0 0 1 .75.75v4h4a.75.75 0 0 1 0 1.5h-4v4a.75.75 0 0 1-1.5 0v-4h-4a.75.75 0 0 1 0-1.5h4v-4A.75.75 0 0 1 8 2.5z"
            />
          </svg>
        </button>
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
            title={
              contextBlocked
                ? "Send (will compact older messages first)"
                : "Send"
            }
            aria-label={
              contextBlocked
                ? "Send (will compact older messages first)"
                : "Send"
            }
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
