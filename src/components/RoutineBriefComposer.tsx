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
  mergeAttachments,
  type ChatAttachment,
} from "../ai/chatAttachments";
import { listChatTools } from "../ai/toolCatalog";
import type { AiModelOption, ChatMode, ReasoningMode } from "../ai/types";
import {
  beginComposerChipDrag,
  chipLabelForPath,
  refreshPathChipLabels,
  composerChipDragSource,
  composerDraftToHtml,
  draftFromDataTransfer,
  endComposerChipDrag,
  focusComposerAfterNode,
  getComposerAtQuery,
  getComposerSlashQuery,
  insertComposerDraft,
  insertPathChip,
  insertSkillChip,
  renderComposerFromDraft,
  replaceAtWithToolChip,
  replaceSlashWithSkillChip,
  serializeComposer,
  serializeComposerSelection,
  syncComposerInputHeight,
  writeComposerDraftToDataTransfer,
} from "../lib/chatComposerDom";
import { projectPathForVaultItem } from "../lib/chatProject";
import { writeClipboardHtml } from "../lib/clipboardText";
import {
  loadBriefAttachment,
  remapAttachmentFolder,
  removeBriefAttachment,
  storeBriefAttachment,
  type RoutineBriefState,
} from "../lib/routineBrief";
import type { RoutineAttachmentRef } from "../lib/routinesApi";
import { listSkills, type SkillMeta } from "../ai/skills";
import {
  clearVaultTreeDrag,
  isVaultTreeDrag,
  pointOverElement,
  subscribeVaultTreeDrag,
  vaultPathFromDrop,
  VAULT_TREE_POINTER_DROP_EVENT,
  type VaultTreePointerDropDetail,
} from "../lib/vaultTreeDrag";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { usePrefsStore } from "../store/prefsStore";
import {
  EMPTY_NOTE_TITLES,
  useNoteTitlesStore,
} from "../store/noteTitlesStore";
import { vaultChatModelId, vaultWorkerModelId } from "../store/vaultAiSettingsStore";
import { isFileTab, useVaultStore } from "../store/vaultStore";
import { EditContextMenu, type EditContextMenuState } from "./EditContextMenu";
import { ChatModePicker } from "./chat/ChatModePicker";
import { ChatModelPicker } from "./chat/ChatModelPicker";
import { ChatProjectPicker } from "./chat/ChatProjectPicker";
import { ChatSkillSlashMenu } from "./chat/ChatSkillSlashMenu";
import { ReasoningToggle } from "./chat/ReasoningToggle";
import { modelSupportsReasoning } from "../ai/models";

function kindLabel(kind: ChatAttachment["kind"]): string {
  if (kind === "image") return "Image";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "Text";
  return "File";
}

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
      if (item && (item.kind === "file" || item.type.startsWith("image/"))) {
        push(item.getAsFile());
      }
    }
  }
  return out;
}

function selectionTextIn(el: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return "";
  return sel.toString();
}

type DragKind = "vault" | "files";

export function RoutineBriefComposer({
  folder,
  initial,
  onChange,
}: {
  folder: string;
  initial: RoutineBriefState;
  onChange: (next: RoutineBriefState) => void;
}) {
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const slashRangeRef = useRef<Range | null>(null);
  const atRangeRef = useRef<Range | null>(null);
  const folderRef = useRef(folder);
  const stateRef = useRef(initial);
  const [brief, setBrief] = useState(initial.brief);
  const [projectPath, setProjectPath] = useState(initial.projectPath);
  const [mode, setMode] = useState<ChatMode>(initial.mode);
  const [modelId, setModelId] = useState(initial.modelId);
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>(initial.reasoningMode);
  const [specialistModelId, setSpecialistModelId] = useState(initial.specialistModelId);
  const [specialistsUseChatModel, setSpecialistsUseChatModel] = useState(
    initial.specialistsUseChatModel,
  );
  const [attachmentRefs, setAttachmentRefs] = useState<RoutineAttachmentRef[]>(
    initial.attachments,
  );
  const [previews, setPreviews] = useState<ChatAttachment[]>([]);
  const [skillsCatalog, setSkillsCatalog] = useState<SkillMeta[]>([]);
  const [dragOver, setDragOver] = useState<DragKind | null>(null);
  const [attachHint, setAttachHint] = useState<string | null>(null);
  const [slashMenu, setSlashMenu] = useState<{ query: string; rect: DOMRect } | null>(null);
  const [atMenu, setAtMenu] = useState<{ query: string; rect: DOMRect } | null>(null);
  const [skillPickerRect, setSkillPickerRect] = useState<DOMRect | null>(null);
  const [contextMenu, setContextMenu] = useState<EditContextMenuState | null>(null);
  const pendingEditRef = useRef<{ text: string; range: Range | null }>({
    text: "",
    range: null,
  });
  const settings = useAiSettingsStore((s) => s.settings);
  const activePath = useVaultStore((s) => s.activePath);
  const tabs = useVaultStore((s) => s.tabs);
  const activeFilePath = useMemo(() => {
    if (!activePath) return null;
    const tab = tabs.find((item) => item.path === activePath);
    return tab && isFileTab(tab) ? activePath : null;
  }, [activePath, tabs]);
  const showNoteTitles = usePrefsStore((s) => s.prefs.showNoteTitles);
  const titlesByPath = useNoteTitlesStore((s) =>
    showNoteTitles ? s.titlesByPath : EMPTY_NOTE_TITLES,
  );

  useEffect(() => {
    const el = inputRef.current;
    if (el) refreshPathChipLabels(el);
  }, [showNoteTitles, titlesByPath]);

  const models: AiModelOption[] = settings.models.length ? settings.models : [];
  const chatModelId = modelId || vaultChatModelId();
  const workerModelId = specialistModelId || vaultWorkerModelId();
  const modelOptions = useMemo(() => {
    if (!chatModelId || models.some((model) => model.id === chatModelId)) return models;
    return [
      {
        id: chatModelId,
        label: chatModelId,
        vendor: "openai" as const,
        kind: "chat" as const,
        tier: "flagship" as const,
      },
      ...models,
    ];
  }, [models, chatModelId]);
  const toolsCatalog = useMemo(() => listChatTools(mode), [mode]);

  const emit = useCallback(
    (next: RoutineBriefState) => {
      stateRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const snapshot = useCallback(
    (patch?: Partial<RoutineBriefState>) => {
      const next = { ...stateRef.current, ...patch };
      emit(next);
      return next;
    },
    [emit],
  );

  useEffect(() => {
    let cancelled = false;
    const refs = stateRef.current.attachments;
    if (refs.length === 0) return;
    void Promise.all(refs.map((ref) => loadBriefAttachment(ref))).then((rows) => {
      if (!cancelled) setPreviews(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (folderRef.current === folder) return;
    const from = folderRef.current;
    folderRef.current = folder;
    const next = remapAttachmentFolder(stateRef.current.attachments, from, folder);
    setAttachmentRefs(next);
    snapshot({ attachments: next });
  }, [folder, snapshot]);

  const refreshSkills = useCallback(() => {
    void listSkills()
      .then(setSkillsCatalog)
      .catch(() => setSkillsCatalog([]));
  }, []);

  const focusAfterChip = (afterNode: Node | null | undefined) => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      focusComposerAfterNode(el, afterNode);
    });
  };

  const closeSkillMenus = () => {
    slashRangeRef.current = null;
    atRangeRef.current = null;
    setSlashMenu(null);
    setAtMenu(null);
    setSkillPickerRect(null);
  };

  const syncDraftFromDom = () => {
    const el = inputRef.current;
    if (!el) return;
    const next = serializeComposer(el);
    setBrief(next);
    el.classList.toggle("is-empty", next.trim().length === 0);
    syncComposerInputHeight(el);
    snapshot({ brief: next });
  };

  const syncMentionMenus = () => {
    const el = inputRef.current;
    if (!el) {
      closeSkillMenus();
      return;
    }
    const slash = getComposerSlashQuery(el);
    if (slash) {
      slashRangeRef.current = slash.range.cloneRange();
      atRangeRef.current = null;
      setAtMenu(null);
      setSkillPickerRect(null);
      setSlashMenu({ query: slash.query, rect: slash.range.getBoundingClientRect() });
      refreshSkills();
      return;
    }
    const at = getComposerAtQuery(el);
    if (at) {
      atRangeRef.current = at.range.cloneRange();
      slashRangeRef.current = null;
      setSlashMenu(null);
      setSkillPickerRect(null);
      setAtMenu({ query: at.query, rect: at.range.getBoundingClientRect() });
      return;
    }
    slashRangeRef.current = null;
    atRangeRef.current = null;
    setSlashMenu(null);
    setAtMenu(null);
  };

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    renderComposerFromDraft(el, stateRef.current.brief);
    el.classList.toggle("is-empty", stateRef.current.brief.trim().length === 0);
    syncComposerInputHeight(el);
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => syncComposerInputHeight(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ingestFiles = async (files: File[]) => {
    const list = files.filter((file) => file.size > 0);
    if (list.length === 0) return;
    const stored: RoutineAttachmentRef[] = [];
    const loaded: ChatAttachment[] = [];
    const rejected: string[] = [];
    for (const file of list) {
      try {
        const ref = await storeBriefAttachment(folderRef.current, file);
        stored.push(ref);
        loaded.push(await loadBriefAttachment(ref));
      } catch (err) {
        rejected.push(err instanceof Error ? err.message : file.name);
      }
    }
    if (rejected.length > 0) setAttachHint(rejected.slice(0, 3).join(" · "));
    else setAttachHint(null);
    if (stored.length === 0) return;
    const mergedRefs = [...stateRef.current.attachments, ...stored].slice(0, 8);
    const dropped = stored.length - (mergedRefs.length - stateRef.current.attachments.length);
    if (dropped > 0) setAttachHint(`Max 8 attachments`);
    setAttachmentRefs(mergedRefs);
    setPreviews((current) => mergeAttachments(current, loaded).next);
    snapshot({ attachments: mergedRefs });
  };

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

  useEffect(() => {
    let stopMove: (() => void) | null = null;
    const unsub = subscribeVaultTreeDrag((path) => {
      stopMove?.();
      stopMove = null;
      if (!path) {
        setDragOver(null);
        return;
      }
      const onMove = (ev: PointerEvent) => {
        const root = composerRef.current;
        setDragOver(pointOverElement(root, ev.clientX, ev.clientY) ? "vault" : null);
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      stopMove = () => window.removeEventListener("pointermove", onMove);
    });
    return () => {
      stopMove?.();
      unsub();
    };
  }, []);

  useEffect(() => {
    const onPointerDrop = (event: Event) => {
      const detail = (event as CustomEvent<VaultTreePointerDropDetail>).detail;
      if (!detail?.path) return;
      const root = composerRef.current;
      if (!pointOverElement(root, detail.clientX, detail.clientY)) return;
      event.preventDefault();
      setDragOver(null);
      const el = inputRef.current;
      clearVaultTreeDrag();
      if (!el) return;
      if (!stateRef.current.projectPath) {
        const project = projectPathForVaultItem(detail.path);
        if (project) {
          setProjectPath(project);
          snapshot({ projectPath: project });
        }
      }
      const after = insertPathChip(el, detail.path, detail.clientX, detail.clientY);
      syncDraftFromDom();
      focusAfterChip(after);
    };
    window.addEventListener(VAULT_TREE_POINTER_DROP_EVENT, onPointerDrop as EventListener);
    return () => {
      window.removeEventListener(VAULT_TREE_POINTER_DROP_EVENT, onPointerDrop as EventListener);
    };
  }, [snapshot]);

  const openComposerContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const el = inputRef.current;
    const selectedDraft = el ? serializeComposerSelection(el) : null;
    const selected = selectedDraft ?? (el ? selectionTextIn(el) : "");
    const sel = window.getSelection();
    let range: Range | null = null;
    if (el && sel && sel.rangeCount > 0) {
      const live = sel.getRangeAt(0);
      if (el.contains(live.commonAncestorContainer)) range = live.cloneRange();
    }
    pendingEditRef.current = { text: selected, range };
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      canCut: selected.length > 0,
      canCopy: selected.length > 0,
      canPaste: true,
      showSelectAll: true,
    });
  };

  const restorePendingRange = () => {
    const { range } = pendingEditRef.current;
    const el = inputRef.current;
    if (!range || !el) return;
    el.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const plusFooterActions = skillPickerRect
    ? [
        {
          id: "active-file",
          label: "Add current file",
          description: activeFilePath
            ? chipLabelForPath(activeFilePath, showNoteTitles ? titlesByPath : null)
            : "No file open",
          title: activeFilePath ?? undefined,
          disabled: !activeFilePath,
        },
      ]
    : undefined;

  return (
    <div
      ref={composerRef}
      className={dragOver ? "chat-composer is-drag-over" : "chat-composer"}
      onDragOver={(event) => {
        const kind = composerChipDragSource()
          ? null
          : isVaultTreeDrag(event.dataTransfer)
            ? "vault"
            : Array.from(event.dataTransfer.types).includes("Files")
              ? "files"
              : null;
        if (!kind) return;
        event.preventDefault();
        setDragOver(kind);
      }}
      onDragLeave={() => setDragOver(null)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(null);
        const el = inputRef.current;
        const chipDraft = draftFromDataTransfer(event.dataTransfer);
        if (el && chipDraft) {
          const after = insertComposerDraft(el, chipDraft, event.clientX, event.clientY);
          syncDraftFromDom();
          focusAfterChip(after);
          endComposerChipDrag();
          clearVaultTreeDrag();
          return;
        }
        const vaultPath = vaultPathFromDrop(event.dataTransfer);
        clearVaultTreeDrag();
        if (vaultPath && el) {
          if (!stateRef.current.projectPath) {
            const project = projectPathForVaultItem(vaultPath);
            if (project) {
              setProjectPath(project);
              snapshot({ projectPath: project });
            }
          }
          const after = insertPathChip(el, vaultPath, event.clientX, event.clientY);
          syncDraftFromDom();
          focusAfterChip(after);
          return;
        }
        const plain = event.dataTransfer.getData("text/plain");
        if (el && plain && !event.dataTransfer.files?.length) {
          const after = insertComposerDraft(el, plain, event.clientX, event.clientY);
          syncDraftFromDom();
          focusAfterChip(after);
          return;
        }
        if (event.dataTransfer.files?.length) {
          void ingestFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      <div
        className={dragOver ? "chat-composer-drop-hint is-visible" : "chat-composer-drop-hint"}
        aria-hidden="true"
      />
      {previews.length > 0 ? (
        <ul className="chat-attach-list" aria-label="Attachments">
          {previews.map((attachment) => (
            <li
              key={attachment.id}
              className={attachment.error ? "chat-attach-chip has-error" : "chat-attach-chip"}
            >
              {attachment.kind === "image" && attachment.dataUrl ? (
                <img className="chat-attach-thumb" src={attachment.dataUrl} alt="" />
              ) : (
                <span className="chat-attach-kind">{kindLabel(attachment.kind)}</span>
              )}
              <span className="chat-attach-meta">
                <span className="chat-attach-name" title={attachment.name}>
                  {attachment.name}
                </span>
                <span className="chat-attach-size">
                  {attachment.error ?? formatAttachmentSize(attachment.size)}
                </span>
              </span>
              <button
                type="button"
                className="chat-attach-remove"
                title="Remove"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => {
                  const ref = attachmentRefs.find((item) => item.id === attachment.id);
                  if (ref) void removeBriefAttachment(ref.path);
                  const next = attachmentRefs.filter((item) => item.id !== attachment.id);
                  setAttachmentRefs(next);
                  setPreviews((rows) => rows.filter((item) => item.id !== attachment.id));
                  snapshot({ attachments: next });
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {attachHint ? (
        <div className="chat-attach-hint" role="status">
          {attachHint}
        </div>
      ) : null}
      <div
        ref={inputRef}
        className={brief.trim() ? "chat-composer-input" : "chat-composer-input is-empty"}
        role="textbox"
        aria-multiline="true"
        aria-label="Routine brief"
        contentEditable
        spellCheck={false}
        suppressContentEditableWarning
        data-placeholder="What should this routine do?"
        onContextMenu={openComposerContextMenu}
        onDragStart={(event) => {
          const target = event.target;
          const el = inputRef.current;
          if (!el || !(target instanceof HTMLElement)) return;
          const chip = target.closest(".chat-path-chip, .chat-selection-chip");
          if (chip instanceof HTMLElement && el.contains(chip)) {
            beginComposerChipDrag(chip, event.dataTransfer);
          }
        }}
        onDragEnd={() => endComposerChipDrag()}
        onCopy={(event) => {
          const el = inputRef.current;
          if (!el || !event.clipboardData) return;
          const draft = serializeComposerSelection(el);
          if (draft == null) return;
          event.preventDefault();
          writeComposerDraftToDataTransfer(event.clipboardData, draft);
        }}
        onCut={(event) => {
          const el = inputRef.current;
          if (!el || !event.clipboardData) return;
          const draft = serializeComposerSelection(el);
          if (draft == null) return;
          event.preventDefault();
          writeComposerDraftToDataTransfer(event.clipboardData, draft);
          window.getSelection()?.getRangeAt(0).deleteContents();
          syncDraftFromDom();
        }}
        onInput={() => {
          syncDraftFromDom();
          syncMentionMenus();
        }}
        onPaste={(event) => {
          const data = event.clipboardData;
          if (!data) return;
          const files = collectPasteFiles(data);
          if (files.length > 0) {
            event.preventDefault();
            void ingestFiles(files);
            return;
          }
          event.preventDefault();
          const el = inputRef.current;
          const chipDraft = draftFromDataTransfer(data);
          if (el && chipDraft) {
            insertComposerDraft(el, chipDraft);
            syncDraftFromDom();
            return;
          }
          const text = data.getData("text/plain");
          if (text) {
            document.execCommand("insertText", false, text);
            syncDraftFromDom();
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
          onSelect={(id) => {
            const el = inputRef.current;
            if (!el) return;
            replaceAtWithToolChip(el, id, atRangeRef.current);
            closeSkillMenus();
            syncDraftFromDom();
            focusAfterChip(null);
          }}
        />
      ) : null}
      {slashMenu != null || skillPickerRect != null ? (
        <ChatSkillSlashMenu
          items={skillsCatalog}
          query={slashMenu?.query ?? ""}
          anchorRect={slashMenu?.rect ?? skillPickerRect}
          excludeCloseRef={plusBtnRef}
          onClose={closeSkillMenus}
          onSelect={(id) => {
            const el = inputRef.current;
            if (!el) return;
            const after = slashMenu
              ? (replaceSlashWithSkillChip(el, id, slashRangeRef.current), null)
              : insertSkillChip(el, id);
            closeSkillMenus();
            syncDraftFromDom();
            focusAfterChip(after);
          }}
          footerActions={plusFooterActions}
          onFooterSelect={(id) => {
            if (id !== "active-file" || !activeFilePath) return;
            const el = inputRef.current;
            if (!el) return;
            const after = insertPathChip(el, activeFilePath);
            closeSkillMenus();
            syncDraftFromDom();
            focusAfterChip(after);
          }}
        />
      ) : null}
      {contextMenu ? (
        <EditContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onCut={() => {
            const { text, range } = pendingEditRef.current;
            if (!text) return;
            void writeClipboardHtml(composerDraftToHtml(text), text);
            if (range && inputRef.current) {
              restorePendingRange();
              range.deleteContents();
              syncDraftFromDom();
            }
          }}
          onCopy={() => {
            const { text } = pendingEditRef.current;
            if (!text) return;
            void writeClipboardHtml(composerDraftToHtml(text), text);
          }}
          onPaste={() => {
            const el = inputRef.current;
            if (pendingEditRef.current.range) restorePendingRange();
            else el?.focus();
            void navigator.clipboard.readText().then((text) => {
              if (!text || !inputRef.current) return;
              document.execCommand("insertText", false, text);
              syncDraftFromDom();
            });
          }}
          onSelectAll={() => {
            const el = inputRef.current;
            if (!el) return;
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }}
        />
      ) : null}
      <div className="chat-composer-toolbar">
        <ChatProjectPicker
          value={projectPath || null}
          onChange={(path) => {
            const next = path ?? "";
            setProjectPath(next);
            snapshot({ projectPath: next });
          }}
        />
        <ChatModePicker
          value={mode}
          onChange={(next) => {
            setMode(next);
            snapshot({ mode: next });
          }}
        />
        <ChatModelPicker
          models={modelOptions}
          value={chatModelId}
          onChange={(next) => {
            setModelId(next);
            snapshot({ modelId: next });
          }}
          specialistValue={workerModelId}
          specialistsLinked={specialistsUseChatModel}
          onSpecialistChange={(next) => {
            setSpecialistModelId(next);
            snapshot({ specialistModelId: next });
          }}
          onSpecialistsLinkedChange={(linked) => {
            setSpecialistsUseChatModel(linked);
            snapshot({ specialistsUseChatModel: linked });
          }}
        />
        <ReasoningToggle
          supported={modelSupportsReasoning(chatModelId, modelOptions)}
          mode={reasoningMode}
          onChange={(next) => {
            setReasoningMode(next);
            snapshot({ reasoningMode: next });
          }}
        />
        <div className="chat-composer-spacer" />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="chat-attach-input"
          accept="image/*,.pdf,.md,.txt,.json,.csv,.html,.xml,.css,.js,.ts,.tsx,.py,.rs,.yaml,.yml,.toml"
          onChange={(event) => {
            const files = event.target.files;
            if (files) void ingestFiles(Array.from(files));
            event.target.value = "";
          }}
        />
        <button
          ref={plusBtnRef}
          type="button"
          className={skillPickerRect ? "chat-attach-btn is-active" : "chat-attach-btn"}
          title="Add skill or file"
          aria-label="Add skill or file"
          aria-expanded={skillPickerRect != null}
          aria-haspopup="listbox"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (skillPickerRect) closeSkillMenus();
            else {
              const btn = plusBtnRef.current;
              if (!btn) return;
              setSlashMenu(null);
              setAtMenu(null);
              setSkillPickerRect(btn.getBoundingClientRect());
              refreshSkills();
            }
          }}
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
          title="Attach files"
          aria-label="Attach files"
          onClick={() => fileInputRef.current?.click()}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M4.5 2.5a3 3 0 0 0-3 3v5a4.5 4.5 0 0 0 9 0V5a2 2 0 1 0-4 0v5.5a.75.75 0 0 0 1.5 0V5a.5.5 0 0 1 1 0v5.5a3 3 0 1 1-6 0v-5a1.5 1.5 0 0 1 3 0v5.5a.75.75 0 0 0 1.5 0V5a3 3 0 0 0-3-3z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
