import "@blocknote/mantine/style.css";
import "katex/dist/katex.min.css";

import { VALID_LINK_PROTOCOLS } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import type { Theme } from "@blocknote/mantine";
import {
  FormattingToolbarController,
  SideMenuController,
  SuggestionMenuController,
  useCreateBlockNote,
  useEditorChange,
} from "@blocknote/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TextSelection } from "prosemirror-state";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { CommentsPanel } from "../components/CommentsPanel";
import { DocumentOutline } from "../components/DocumentOutline";
import {
  EditContextMenu,
  type EditContextMenuState,
} from "../components/EditContextMenu";
import { ImageLightbox } from "../components/ImageLightbox";
import { NotePageChrome } from "../components/NotePageChrome";
import {
  WikiLinkPickerDialog,
  type WikiLinkPickerResult,
} from "../components/WikiLinkPickerDialog";
import { decorateBrokenVaultLinks } from "../lib/brokenLinks";
import { registerLiveEditor } from "./completedTasksCommand";
import { registerLiveEditorFlush } from "./liveEditorFlush";
import { NoteSideMenu } from "./NoteDragHandleMenu";
import {
  NoteFormattingToolbar,
  NoteFormattingToolbarProvider,
} from "./NoteFormattingToolbar";
import {
  editorMarkdownToHashtags,
} from "../lib/hashtagMarkdown";
import {
  applyImagePreviewWidths,
  collectImageSizeRefs,
  restoreImagePreviewWidthsFromAlt,
} from "../lib/imageMarkdown";
import {
  editorMarkdownToMath,
  mathToEditorMarkdown,
} from "../lib/mathMarkdown";
import {
  markdownToNestedBlocks,
  nestedHtmlToMarkdown,
} from "../lib/nestedListMarkdown";
import { noteBody, withNoteBody } from "../lib/noteFrontmatter";
import { normalizeMarkdown } from "../lib/normalizeMarkdown";
import {
  applyColoredTableHtml,
  projectColoredTables,
} from "../lib/tableMarkdown";
import {
  isExternalHref,
  isWikiHref,
  markdownToWiki,
  wikiTargetFromHref,
  wikiToMarkdown,
} from "../lib/wikiMarkdown";
import {
  absolutePath,
  createNote,
  ensureFolderNote,
  folderPathFromFolderNote,
  isDrawioPath,
  joinPath,
  parentPath,
  resolveWikiTarget,
  writeAsset,
  type NoteComment,
} from "../lib/vaultApi";
import { isUnderDiaryProject } from "../lib/diaryNotes";
import { writeClipboardText } from "../lib/clipboardText";
import { editorFontStack } from "../settings/applyPrefs";
import type { ThemeId } from "../settings/types";
import { usePrefsStore } from "../store/prefsStore";
import { openCaptureDialog } from "../store/captureStore";
import { useVaultStore } from "../store/vaultStore";
import { createLayoutAgnosticKeymapExtension } from "./layoutAgnosticKeymap";
import { createListOnlyNestingExtension } from "./listOnlyNesting";
import { NoteSlashSuggestionMenu } from "./NoteSlashSuggestionMenu";
import { suggestionMenuFloatingOptions } from "./suggestionMenuFloating";
import {
  createImagePasteHandler,
  markPasteGestureHandled,
  pasteImagesFromSystemClipboard,
  readTextFromSystemClipboard,
  warnClipboardImageMissing,
} from "./pasteImages";
import {
  recordSegmentChanges,
  SegmentMarkdownCache,
  type SegmentBlock,
} from "./incrementalSerialize";
import {
  passthroughStage,
  verifyIncrementalSerialization,
  withSerializeProfile,
  type StageTimer,
} from "./serializeProfile";
import { noteEditorSchema } from "./schema";
import { createSelectAtomBlockAfterDropExtension } from "./selectAtomBlockAfterDrop";
import { getNoteSlashMenuItems } from "./slashMenuItems";
import { insertDrawioEmbed } from "./drawio/slashItem";
import type { WikiLinkPickerOpenOpts } from "./wikiLink/slashItem";
import {
  clearBlockNoteDropCursor,
  clearDrawioTreeDrag,
  DRAWIO_TREE_MIME,
  drawioPathFromDrop,
  getActiveDrawioTreeDrag,
} from "./drawio/treeDrag";
import {
  clearVaultTreeDrag,
  pointOverElement,
  VAULT_TREE_POINTER_DROP_EVENT,
  type VaultTreePointerDropDetail,
} from "../lib/vaultTreeDrag";
import {
  createCommentDecorationExtension,
  getCommentRanges,
  scrollToCommentRange,
  setCommentDecorationsMeta,
} from "./comment/commentDecorations";
import { refreshDocumentFindIfOpen } from "./find/documentFindController";
import { createFindDecorationExtension } from "./find/findDecorations";
import { createHashtagDecorationExtension } from "./tag/tagDecorations";
import { createCodeBlockCopyExtension } from "./codeBlockCopy";
import { getTagMenuItems, shouldOpenTagMenu } from "./tag/tagSuggestion";
import { TagSuggestionMenu } from "./tag/TagSuggestionMenu";
import { focusLiveEditorFromEmptyClick } from "./focusLiveEditor";
import {
  clampOutlineWidth,
  loadDocOutlineUi,
  saveDocOutlineWidth,
  OUTLINE_WIDTH_MIN,
  OUTLINE_WIDTH_MAX,
} from "../lib/outlineUiState";
import {
  clampCommentsWidth,
  loadDocCommentsUi,
  saveDocCommentsWidth,
  COMMENTS_WIDTH_MIN,
  COMMENTS_WIDTH_MAX,
} from "../lib/commentsUiState";
import type { CommentAnchor } from "../lib/commentAnchors";
import {
  captureCommentAnchor,
  findCommentRanges,
  sortCommentsByDocumentOrder,
  type StructuralAnchor,
} from "../lib/commentAnchors";
import { CommentConnectors } from "../components/CommentConnectors";
import { usePersistedEditorScroll } from "../hooks/usePersistedEditorScroll";

function buildEditorTheme(
  theme: ThemeId,
  fontFamily: string,
): Theme {
  const dark = theme === "dark";
  return {
    fontFamily,
    borderRadius: 8,
    colors: {
      editor: {
        text: dark ? "#e7eef2" : "#1c2428",
        background: dark ? "#1a2228" : "#ffffff",
      },
      menu: {
        text: dark ? "#e7eef2" : "#1c2428",
        background: dark ? "#243038" : "#ffffff",
      },
      tooltip: {
        text: dark ? "#e7eef2" : "#1c2428",
        background: dark ? "#243038" : "#ffffff",
      },
      hovered: {
        text: dark ? "#e7eef2" : "#1c2428",
        background: "color-mix(in srgb, var(--accent) 12%, transparent)",
      },
      selected: {
        text: dark ? "#e7eef2" : "#1c2428",
        background: "color-mix(in srgb, var(--accent) 18%, transparent)",
      },
      disabled: {
        text: dark ? "#6b7c86" : "#9aa7af",
        background: "transparent",
      },
      shadow: dark ? "rgba(0, 0, 0, 0.35)" : "rgba(20, 30, 34, 0.12)",
      border: dark ? "rgba(231, 238, 242, 0.12)" : "rgba(28, 36, 40, 0.12)",
      sideMenu: dark ? "#8a9aa3" : "#5d6b73",
      highlights: {
        gray: { text: dark ? "#8a9aa3" : "#5d6b73", background: "rgba(31, 42, 48, 0.12)" },
        brown: { text: "#6b4f3a", background: "rgba(107, 79, 58, 0.12)" },
        red: { text: "#b44848", background: "rgba(180, 72, 72, 0.12)" },
        orange: { text: "#b86a2f", background: "rgba(184, 106, 47, 0.12)" },
        yellow: { text: "#8a7424", background: "rgba(138, 116, 36, 0.14)" },
        green: { text: "#237463", background: "rgba(47, 143, 123, 0.14)" },
        blue: { text: "#2f6f8f", background: "rgba(47, 111, 143, 0.12)" },
        purple: { text: "#6b4f8f", background: "rgba(107, 79, 143, 0.12)" },
        pink: { text: "#8f4f6b", background: "rgba(143, 79, 107, 0.12)" },
      },
    },
  };
}

function isRemoteOrDataUrl(url: string): boolean {
  return /^(https?:|data:|blob:|asset:|tauri:)/i.test(url);
}

/** BlockNote's default allowlist plus MarkSpace `wiki:` links. */
function isEditorLink(href: string): boolean {
  if (href.startsWith("wiki:")) return true;
  try {
    const parsed = new URL(href);
    return VALID_LINK_PROTOCOLS.includes(parsed.protocol.replace(/:$/, ""));
  } catch {
    // Relative paths / bare fragments — keep BlockNote default behavior loose.
    return !/^[a-z][a-z0-9+.-]*:/i.test(href);
  }
}

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
  /** False for keep-alive hidden tabs — skip chrome, listeners, comment work. */
  isActive?: boolean;
};

/**
 * Delay Live→markdown export so keystrokes can paint before heavy serialize.
 *
 * The export re-serializes the whole document (BlockNote HTML → markdown), which
 * costs ~50ms on a 15KB note and ~190ms on a 60KB one. At 150ms the timer landed
 * inside ordinary pauses between words, so the editor hitched at nearly every
 * word boundary. Every consumer of the store `content` goes through
 * `flushLiveEditor` first (save, tab switch/close, Live↔Source, window close),
 * so a longer debounce only delays derived UI, never persistence.
 */
const LIVE_SERIALIZE_MS = 1_000;

/** Upper bound on the idle wait, so a busy main thread cannot starve the export. */
const LIVE_SERIALIZE_IDLE_TIMEOUT_MS = 1_000;

/**
 * `incremental` reuses cached markdown for untouched segments and only ever
 * feeds derived UI; anything headed for disk goes through `full`.
 */
type SerializeMode = "full" | "incremental";

type IdleHandle =
  | { kind: "idle"; id: number }
  | { kind: "timeout"; id: number };

/** `requestIdleCallback` with a deadline; falls back where it is unavailable. */
function scheduleIdle(run: () => void, timeout: number): IdleHandle {
  if (typeof window.requestIdleCallback === "function") {
    return { kind: "idle", id: window.requestIdleCallback(run, { timeout }) };
  }
  return { kind: "timeout", id: window.setTimeout(run, 0) };
}

function cancelIdle(handle: IdleHandle): void {
  if (handle.kind === "idle") {
    window.cancelIdleCallback(handle.id);
    return;
  }
  window.clearTimeout(handle.id);
}

const EMPTY_COMMENTS: NoteComment[] = [];

export const NoteEditor = memo(function NoteEditor({
  path,
  content,
  onChange,
  isActive = true,
}: Props) {
  const openNote = useVaultStore((s) => s.openNote);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const markDirty = useVaultStore((s) => s.markDirty);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  // Inactive keep-alive tabs must not follow the active note's outline/comments.
  const showOutline = useVaultStore((s) => {
    if (!isActive) return false;
    return s.showOutline;
  });
  const showComments = useVaultStore((s) => {
    if (!isActive) return false;
    return s.showComments;
  });
  const activeNoteComments = useVaultStore((s) =>
    isActive ? s.activeNoteComments : EMPTY_COMMENTS,
  );
  const upsertActiveComment = useVaultStore((s) => s.upsertActiveComment);
  const deleteActiveComment = useVaultStore((s) => s.deleteActiveComment);
  const setActiveCommentResolved = useVaultStore(
    (s) => s.setActiveCommentResolved,
  );
  const takePendingCommentFocus = useVaultStore(
    (s) => s.takePendingCommentFocus,
  );
  const pendingCommentFocusId = useVaultStore((s) =>
    isActive ? s.pendingCommentFocusId : null,
  );
  const [editorMainEl, setEditorMainEl] = useState<HTMLDivElement | null>(null);
  usePersistedEditorScroll(editorMainEl, path, "live", {
    active: isActive,
    skipRestore: Boolean(pendingCommentFocusId),
  });
  const theme = usePrefsStore((s) => s.prefs.theme);
  const liveFontFamily = usePrefsStore((s) => s.prefs.liveFontFamily);
  const liveFontSize = usePrefsStore((s) => s.prefs.liveFontSize);
  const liveFontSizeDiary = usePrefsStore((s) => s.prefs.liveFontSizeDiary);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const diaryLiveFont = isUnderDiaryProject(path, projectPropertiesByPath);
  const canvasLiveFontSize = diaryLiveFont ? liveFontSizeDiary : liveFontSize;
  const applyingRef = useRef(false);
  const adoptNextChangeRef = useRef(false);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const lastPathRef = useRef<string | null>(null);
  /** Full file content last seen from props / emitted onChange. */
  const lastExternalRef = useRef(content);
  /** Full file used as frontmatter source when merging Live body edits. */
  const frontmatterBaseRef = useRef(content);
  /** Last body markdown loaded into / serialized from BlockNote. */
  const lastBodyRef = useRef(noteBody(content));
  const notePathRef = useRef(path);
  notePathRef.current = path;
  const editorRef = useRef<ReturnType<typeof useCreateBlockNote> | null>(null);
  const [viewedImage, setViewedImage] = useState<{ src: string; alt: string } | null>(
    null,
  );
  const [wikiLinkPicker, setWikiLinkPicker] = useState<{
    initialLabel: string;
  } | null>(null);
  const wikiLinkSelRef = useRef<{ from: number; to: number } | null>(null);
  const [outlineWidth, setOutlineWidth] = useState(
    () => loadDocOutlineUi(vaultPath, path).width,
  );
  const [commentsWidth, setCommentsWidth] = useState(
    () => loadDocCommentsUi(vaultPath, path).width,
  );
  const [showResolvedComments, setShowResolvedComments] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    quote: string;
    prefix: string;
    suffix: string;
    anchor: StructuralAnchor;
  } | null>(null);

  const persistOutlineWidth = useCallback(
    (width: number) => {
      saveDocOutlineWidth(vaultPath, path, width);
    },
    [vaultPath, path],
  );

  const persistCommentsWidth = useCallback(
    (width: number) => {
      saveDocCommentsWidth(vaultPath, path, width);
    },
    [vaultPath, path],
  );

  const onOutlineSplitterPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = outlineWidth;
      const target = event.currentTarget;
      // Drive width via DOM during drag — setState every move re-renders BlockNote.
      const outlineEl = target.previousElementSibling as HTMLElement | null;
      target.setPointerCapture(event.pointerId);
      target.classList.add("is-active");
      let latest = startWidth;

      const onMove = (ev: PointerEvent) => {
        latest = clampOutlineWidth(startWidth + (ev.clientX - startX));
        if (outlineEl) {
          outlineEl.style.width = `${latest}px`;
          outlineEl.style.flexBasis = `${latest}px`;
        }
        target.setAttribute("aria-valuenow", String(latest));
      };
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.classList.remove("is-active");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setOutlineWidth(latest);
        persistOutlineWidth(latest);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [outlineWidth, persistOutlineWidth],
  );

  const onCommentsSplitterPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = commentsWidth;
      const target = event.currentTarget;
      // Dragging left grows the panel (splitter is on the left edge).
      const commentsEl = target.nextElementSibling as HTMLElement | null;
      target.setPointerCapture(event.pointerId);
      target.classList.add("is-active");
      let latest = startWidth;

      const onMove = (ev: PointerEvent) => {
        latest = clampCommentsWidth(startWidth - (ev.clientX - startX));
        if (commentsEl) {
          commentsEl.style.width = `${latest}px`;
          commentsEl.style.flexBasis = `${latest}px`;
        }
        target.setAttribute("aria-valuenow", String(latest));
      };
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.classList.remove("is-active");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setCommentsWidth(latest);
        persistCommentsWidth(latest);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [commentsWidth, persistCommentsWidth],
  );

  const editorTheme = useMemo(
    () => buildEditorTheme(theme, editorFontStack(liveFontFamily)),
    [theme, liveFontFamily],
  );

  const uploadFile = useCallback(async (file: File, _blockId?: string) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name?.trim() || "image.png";
    return writeAsset(notePathRef.current, name, bytes);
  }, []);

  const resolveFileUrl = useCallback(async (url: string) => {
    if (!url || isRemoteOrDataUrl(url)) return url;
    const cleaned = url.replace(/^\.\//, "");
    const noteParent = parentPath(notePathRef.current);
    const assetRel = joinPath(noteParent, cleaned);
    try {
      const abs = await absolutePath(assetRel);
      return convertFileSrc(abs);
    } catch {
      return url;
    }
  }, []);

  const pasteHandler = useMemo(() => createImagePasteHandler(), []);

  const uploadFileRef = useRef(uploadFile);
  uploadFileRef.current = uploadFile;
  const resolveFileUrlRef = useRef(resolveFileUrl);
  resolveFileUrlRef.current = resolveFileUrl;
  const pasteHandlerRef = useRef(pasteHandler);
  pasteHandlerRef.current = pasteHandler;

  const layoutKeymap = useMemo(
    () => createLayoutAgnosticKeymapExtension(() => editorRef.current),
    [],
  );
  const listOnlyNesting = useMemo(
    () => createListOnlyNestingExtension(() => editorRef.current),
    [],
  );
  const selectAtomAfterDrop = useMemo(
    () => createSelectAtomBlockAfterDropExtension(),
    [],
  );
  const hashtagDecorations = useMemo(
    () => createHashtagDecorationExtension(),
    [],
  );
  const codeBlockCopy = useMemo(() => createCodeBlockCopyExtension(), []);
  const onAnchorsChangedRef = useRef<
    ((updates: import("../lib/commentAnchors").CommentAnchorUpdate[]) => void) | undefined
  >(undefined);
  const commentDecorations = useMemo(
    () =>
      createCommentDecorationExtension({
        getOnAnchorsChanged: () => onAnchorsChangedRef.current,
      }),
    [],
  );
  const findDecorations = useMemo(() => createFindDecorationExtension(), []);

  const editor = useCreateBlockNote(
    {
      schema: noteEditorSchema,
      // Default "prefer-navigate-ui" sends Tab into the formatting toolbar when a
      // block/range is selected (toolbar open) — focus jumps and the page scrolls
      // instead of nesting. Prefer indent like Notion/Obsidian.
      tabBehavior: "prefer-indent",
      tables: {
        cellBackgroundColor: true,
        cellTextColor: true,
      },
      links: {
        isValidLink: isEditorLink,
      },
      uploadFile: (file, blockId) => uploadFileRef.current(file, blockId),
      resolveFileUrl: (url) => resolveFileUrlRef.current(url),
      pasteHandler: (ctx) => pasteHandlerRef.current(ctx),
      // Browser spellcheck red-squiggles are noise in notes (esp. wiki names / other languages).
      domAttributes: {
        editor: {
          spellcheck: "false",
        },
      },
      _tiptapOptions: {
        extensions: [
          layoutKeymap,
          listOnlyNesting,
          selectAtomAfterDrop,
          hashtagDecorations,
          codeBlockCopy,
          commentDecorations,
          findDecorations,
        ],
      },
    },
    [path],
  );
  editorRef.current = editor;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const serializeTimerRef = useRef<number | null>(null);
  const idleHandleRef = useRef<IdleHandle | null>(null);
  const pendingSerializeRef = useRef(false);
  const segmentCacheRef = useRef(new SegmentMarkdownCache<SegmentBlock>());
  const lastEmitWasIncrementalRef = useRef(false);

  useEffect(() => {
    segmentCacheRef.current = new SegmentMarkdownCache<SegmentBlock>();
    lastEmitWasIncrementalRef.current = false;
  }, [editor]);

  const cancelScheduledSerialize = useCallback(() => {
    if (serializeTimerRef.current != null) {
      window.clearTimeout(serializeTimerRef.current);
      serializeTimerRef.current = null;
    }
    if (idleHandleRef.current != null) {
      cancelIdle(idleHandleRef.current);
      idleHandleRef.current = null;
    }
  }, []);

  /** Whole-document export: the only thing ever allowed to reach disk. */
  const serializeWholeDocument = useCallback(
    (ed: typeof editor, stage: StageTimer) => {
      const html = stage("blocksToHtml", () =>
        ed.blocksToHTMLLossy(ed.document),
      );
      return stage("htmlToMarkdown", () => nestedHtmlToMarkdown(html));
    },
    [],
  );

  const emitSerializedMarkdown = useCallback(
    (ed: typeof editor, mode: SerializeMode = "full") => {
      const wikiMd = withSerializeProfile(`${path} ${mode}`, (stage) => {
        let base: string;
        if (mode === "incremental") {
          base = stage("segments", () =>
            segmentCacheRef.current.serialize(
              ed.document as unknown as SegmentBlock[],
              (blocks) =>
                nestedHtmlToMarkdown(
                  ed.blocksToHTMLLossy(blocks as unknown as typeof ed.document),
                ),
            ),
          );
          verifyIncrementalSerialization(path, base, () =>
            serializeWholeDocument(ed, passthroughStage),
          );
        } else {
          base = serializeWholeDocument(ed, stage);
          // The cache saw none of this, so the next incremental pass starts cold.
          segmentCacheRef.current.invalidateAll();
        }

        return stage("postProcess", () => {
          let md = applyImagePreviewWidths(
            base,
            collectImageSizeRefs(ed.document),
          );
          md = applyColoredTableHtml(
            md,
            projectColoredTables(ed.document, (blocks) =>
              ed.blocksToHTMLLossy(blocks as typeof ed.document),
            ),
          );
          return markdownToWiki(
            editorMarkdownToMath(editorMarkdownToHashtags(md)),
          );
        });
      });
      lastEmitWasIncrementalRef.current = mode === "incremental";
      const full = withNoteBody(frontmatterBaseRef.current, wikiMd);
      // External loads / round-trips: adopt serialization, do not pin preview.
      if (applyingRef.current || adoptNextChangeRef.current) {
        lastBodyRef.current = wikiMd;
        frontmatterBaseRef.current = withNoteBody(
          frontmatterBaseRef.current,
          wikiMd,
        );
        lastExternalRef.current = frontmatterBaseRef.current;
        if (!applyingRef.current) adoptNextChangeRef.current = false;
        return;
      }
      if (full === lastExternalRef.current) return;
      lastBodyRef.current = wikiMd;
      frontmatterBaseRef.current = full;
      lastExternalRef.current = full;
      onChangeRef.current(full);
    },
    [editor, path, serializeWholeDocument],
  );

  const flushSerialize = useCallback(() => {
    cancelScheduledSerialize();
    // Even with nothing pending, a cached incremental result may be what the
    // store holds. Redo it whole so only a full export is ever persisted.
    if (!pendingSerializeRef.current && !lastEmitWasIncrementalRef.current) {
      return;
    }
    pendingSerializeRef.current = false;
    const ed = editorRef.current;
    if (!ed) return;
    emitSerializedMarkdown(ed, "full");
  }, [emitSerializedMarkdown, cancelScheduledSerialize]);

  useEffect(() => registerLiveEditorFlush(path, flushSerialize), [
    path,
    flushSerialize,
  ]);

  useEffect(() => {
    const unreg = registerLiveEditor(path, editor);
    refreshDocumentFindIfOpen();
    return unreg;
  }, [path, editor]);

  useEffect(() => {
    return () => {
      cancelScheduledSerialize();
      if (!pendingSerializeRef.current) return;
      pendingSerializeRef.current = false;
      const ed = editorRef.current;
      if (ed) emitSerializedMarkdown(ed, "full");
    };
  }, [editor, emitSerializedMarkdown, cancelScheduledSerialize]);

  useEditorChange((ed, context) => {
    recordSegmentChanges(segmentCacheRef.current, context);
    if (isActiveRef.current) refreshDocumentFindIfOpen();
    // Load/replaceBlocks must adopt serialization synchronously.
    if (applyingRef.current || adoptNextChangeRef.current) {
      cancelScheduledSerialize();
      pendingSerializeRef.current = false;
      emitSerializedMarkdown(ed, "full");
      return;
    }
    // Keep-alive hidden editors must not mark the active note dirty.
    if (!isActiveRef.current) return;
    pendingSerializeRef.current = true;
    markDirty();
    cancelScheduledSerialize();
    serializeTimerRef.current = window.setTimeout(() => {
      serializeTimerRef.current = null;
      if (!pendingSerializeRef.current) return;
      // Typing may resume right as the debounce elapses; take an idle slot so
      // the export yields to input and paint instead of blocking them.
      idleHandleRef.current = scheduleIdle(() => {
        idleHandleRef.current = null;
        if (!pendingSerializeRef.current) return;
        pendingSerializeRef.current = false;
        const current = editorRef.current;
        if (current) emitSerializedMarkdown(current, "incremental");
      }, LIVE_SERIALIZE_IDLE_TIMEOUT_MS);
    }, LIVE_SERIALIZE_MS);
  }, editor);

  const openWikiLinkPicker = useCallback(
    (opts?: WikiLinkPickerOpenOpts) => {
      const sel = editor.prosemirrorView.state.selection;
      const from = opts?.from ?? sel.from;
      const to = opts?.to ?? sel.to;
      const initialLabel =
        opts?.initialLabel ?? editor.getSelectedText()?.trim() ?? "";
      wikiLinkSelRef.current = { from, to };
      setWikiLinkPicker({ initialLabel });
    },
    [editor],
  );

  const confirmWikiLink = useCallback(
    (result: WikiLinkPickerResult) => {
      const href = `wiki:${encodeURIComponent(result.target)}`;
      const bookmark = wikiLinkSelRef.current;
      wikiLinkSelRef.current = null;
      setWikiLinkPicker(null);

      if (bookmark) {
        try {
          editor.transact((tr) => {
            const max = tr.doc.content.size;
            const from = Math.max(0, Math.min(bookmark.from, max));
            const to = Math.max(0, Math.min(bookmark.to, max));
            tr.setSelection(TextSelection.create(tr.doc, from, to));
          });
        } catch {
          /* doc changed while dialog was open */
        }
      }

      editor.createLink(href, result.label);
      editor.focus();
    },
    [editor],
  );

  const getSlashMenuItems = useCallback(
    async (query: string) =>
      getNoteSlashMenuItems(editor, query, path, openWikiLinkPicker),
    [editor, path, openWikiLinkPicker],
  );

  const getHashTagMenuItems = useCallback(
    async (query: string) => getTagMenuItems(editor, query),
    [editor],
  );

  useEffect(() => {
    const pathChanged = lastPathRef.current !== path;
    const externalChange = content !== lastExternalRef.current;
    if (!pathChanged && !externalChange) return;

    frontmatterBaseRef.current = content;
    lastExternalRef.current = content;
    lastPathRef.current = path;

    // Compare normalized bodies: autosave stamps frontmatter and may heal lists
    // via normalizeMarkdown. Live's lastBodyRef is the raw editor serialization,
    // so an un-normalized compare falsely rebuilds the doc (scroll jumps to top).
    const body = noteBody(normalizeMarkdown(content));
    const prevBody = normalizeMarkdown(lastBodyRef.current);
    const bodyChanged = pathChanged || body !== prevBody;
    if (!bodyChanged) {
      lastBodyRef.current = body;
      return;
    }

    const scroller =
      (editor.domElement?.closest(".editor-main") as HTMLElement | null) ?? null;
    const scrollTop = scroller?.scrollTop ?? 0;

    applyingRef.current = true;
    // Strip any leftover Live HTML tag spans from older builds; keep `#tag` as text.
    // Project `$…$` / `$$…$$` into BlockNote math HTML before parse.
    const blocks = restoreImagePreviewWidthsFromAlt(
      markdownToNestedBlocks(
        editor,
        mathToEditorMarkdown(editorMarkdownToHashtags(wikiToMarkdown(body))),
      ),
    );
    editor.replaceBlocks(editor.document, blocks);
    lastBodyRef.current = body;
    adoptNextChangeRef.current = true;
    // replaceBlocks may notify listeners after this tick.
    queueMicrotask(() => {
      applyingRef.current = false;
      if (scroller) scroller.scrollTop = scrollTop;
      queueMicrotask(() => {
        adoptNextChangeRef.current = false;
        if (scroller) scroller.scrollTop = scrollTop;
      });
    });
  }, [editor, path, content]);

  const handleLinkClick = useCallback(
    (event: React.MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      // Ctrl/Cmd+click → permanent tab (like VS Code / browsers “open in new tab”).
      const openPinned = event.ctrlKey || event.metaKey;

      void (async () => {
        const go = (path: string) =>
          openPinned
            ? openNote(path, { preview: false })
            : openNote(path, { replaceActive: true });

        if (isWikiHref(href)) {
          const wikiTarget = wikiTargetFromHref(href);
          let resolved = await resolveWikiTarget(wikiTarget);
          if (!resolved) {
            // Specialized vault docs must already exist — never invent a .md sibling.
            if (/\.(mddict|mdlnks|mdhabit|mdcourse|drawio|pdf)$/i.test(wikiTarget.trim())) {
              await go(wikiTarget.trim().replace(/^\/+/, ""));
              return;
            }
            const created = await createNote(wikiTarget);
            await refreshTree();
            await go(created);
            return;
          }
          const folder = folderPathFromFolderNote(resolved);
          const notePath = folder ? await ensureFolderNote(folder) : resolved;
          await go(notePath);
          return;
        }
        if (isExternalHref(href)) {
          await openUrl(href);
          return;
        }
        const cleanedHref = href.replace(/^\.\//, "");
        let resolved = await resolveWikiTarget(cleanedHref.replace(/\.md$/i, ""));
        if (!resolved && cleanedHref.endsWith(".md")) {
          resolved = await resolveWikiTarget(cleanedHref);
        }
        if (resolved) {
          const folder = folderPathFromFolderNote(resolved);
          if (folder) {
            resolved = await ensureFolderNote(folder);
          }
          await go(resolved);
        }
      })();
    },
    [openNote, refreshTree],
  );

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const timer = window.setTimeout(() => {
      void decorateBrokenVaultLinks(el);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [content, path, editor]);

  const handleImageDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.matches("img.bn-visual-media")) return;
    const src = target.currentSrc || target.src;
    if (!src) return;
    event.preventDefault();
    event.stopPropagation();
    setViewedImage({ src, alt: target.alt });
  }, []);

  // Tree DnD is scoped to the sidebar so HTML5Backend does not kill BlockNote's
  // native block drag. Draw.io embeds from the tree use a path bridge + native drop.
  // Capture+stopPropagation keeps ProseMirror's drop pipeline out (it breaks atom
  // diagram selection); clear the drop-cursor via dragleave only.
  const shellRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<EditContextMenuState | null>(
    null,
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openEditorContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const selected = editor.getSelectedText();
      const sel = editor._tiptapEditor?.state.selection;
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        canCut: selected.length > 0,
        canCopy: selected.length > 0,
        canPaste: true,
        showComment: !!sel && !sel.empty,
        showCapture: !!sel && !sel.empty,
      });
    },
    [editor],
  );

  const startCommentFromSelection = useCallback(() => {
    const tiptap = editor._tiptapEditor;
    const { from, to } = tiptap.state.selection;
    if (from === to) return;
    const captured = captureCommentAnchor(tiptap.state.doc, from, to);
    if (!captured) return;
    setDraft(captured);
    if (!useVaultStore.getState().showComments) {
      useVaultStore.getState().toggleComments();
    }
  }, [editor]);

  const startCaptureFromSelection = useCallback(() => {
    const text = editor.getSelectedText().trim();
    openCaptureDialog({
      quote: text || undefined,
      sourcePath: path,
    });
  }, [editor, path]);

  const commentAnchors: CommentAnchor[] = useMemo(
    () =>
      activeNoteComments.map((c) => ({
        id: c.id,
        quote: c.quote,
        prefix: c.prefix,
        suffix: c.suffix,
        resolved: c.resolved,
        anchor: c.anchor ?? null,
      })),
    [activeNoteComments],
  );

  const anchorPersistTimerRef = useRef<number | null>(null);
  const pendingAnchorUpdatesRef = useRef<
    Map<string, import("../lib/commentAnchors").CommentAnchorUpdate>
  >(new Map());

  useEffect(() => {
    onAnchorsChangedRef.current = (updates) => {
      for (const u of updates) {
        pendingAnchorUpdatesRef.current.set(u.id, u);
      }
      if (anchorPersistTimerRef.current != null) {
        window.clearTimeout(anchorPersistTimerRef.current);
      }
      anchorPersistTimerRef.current = window.setTimeout(() => {
        anchorPersistTimerRef.current = null;
        const batch = [...pendingAnchorUpdatesRef.current.values()];
        pendingAnchorUpdatesRef.current.clear();
        const comments = useVaultStore.getState().activeNoteComments;
        for (const u of batch) {
          const existing = comments.find((c) => c.id === u.id);
          if (!existing) continue;
          if (
            existing.quote === u.quote &&
            existing.prefix === u.prefix &&
            existing.suffix === u.suffix &&
            JSON.stringify(existing.anchor ?? null) ===
              JSON.stringify(u.anchor)
          ) {
            continue;
          }
          void useVaultStore.getState().upsertActiveComment({
            id: existing.id,
            quote: u.quote,
            prefix: u.prefix,
            suffix: u.suffix,
            anchor: u.anchor,
            body: existing.body,
            resolved: existing.resolved,
          });
        }
      }, 450);
    };
    return () => {
      onAnchorsChangedRef.current = undefined;
      if (anchorPersistTimerRef.current != null) {
        window.clearTimeout(anchorPersistTimerRef.current);
        anchorPersistTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const view = editor._tiptapEditor?.view;
    if (!view) return;
    setCommentDecorationsMeta(view, {
      comments: commentAnchors,
      showResolved: showResolvedComments,
      activeId: activeCommentId,
    });
  }, [
    editor,
    isActive,
    commentAnchors,
    showResolvedComments,
    activeCommentId,
  ]);

  const [commentLayoutTick, setCommentLayoutTick] = useState(0);
  useEffect(() => {
    if (!isActive || !showComments) return;
    const tip = editor._tiptapEditor;
    if (!tip) return;
    let raf = 0;
    const bump = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setCommentLayoutTick((n) => n + 1);
      });
    };
    tip.on("transaction", bump);
    // After decorations meta applies, remount measures need a frame.
    raf = requestAnimationFrame(() => {
      raf = 0;
      setCommentLayoutTick((n) => n + 1);
    });
    return () => {
      tip.off("transaction", bump);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    editor,
    isActive,
    showComments,
    path,
    commentAnchors,
    showResolvedComments,
  ]);

  const commentsInDocOrder = useMemo(() => {
    const view = editor._tiptapEditor?.view;
    let ranges = view ? getCommentRanges(view) : [];
    if (ranges.length === 0 && commentAnchors.length > 0 && view) {
      ranges = findCommentRanges(view.state.doc, commentAnchors);
    }
    return sortCommentsByDocumentOrder(activeNoteComments, ranges);
  }, [activeNoteComments, commentAnchors, editor, commentLayoutTick]);

  const visibleConnectorIds = useMemo(
    () =>
      (showResolvedComments
        ? commentsInDocOrder
        : commentsInDocOrder.filter((c) => !c.resolved)
      ).map((c) => c.id),
    [commentsInDocOrder, showResolvedComments],
  );

  const resolvedById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of activeNoteComments) m.set(c.id, c.resolved);
    return m;
  }, [activeNoteComments]);

  useEffect(() => {
    setOutlineWidth(loadDocOutlineUi(vaultPath, path).width);
    setCommentsWidth(loadDocCommentsUi(vaultPath, path).width);
    setDraft(null);
    setActiveCommentId(null);
    pendingAnchorUpdatesRef.current.clear();
    const view = editor._tiptapEditor?.view;
    if (view) {
      // Re-resolve quotes after switching notes / external load.
      setCommentDecorationsMeta(view, {
        comments: useVaultStore.getState().activeNoteComments.map((c) => ({
          id: c.id,
          quote: c.quote,
          prefix: c.prefix,
          suffix: c.suffix,
          resolved: c.resolved,
          anchor: c.anchor ?? null,
        })),
        resetRanges: true,
      });
    }
  }, [vaultPath, path, editor]);

  useEffect(() => {
    const pending = useVaultStore.getState().pendingCommentFocusId;
    if (!pending) return;
    if (!commentAnchors.some((c) => c.id === pending)) return;
    const id = takePendingCommentFocus();
    if (!id) return;
    setActiveCommentId(id);
    if (!useVaultStore.getState().showComments) {
      useVaultStore.getState().toggleComments();
    }
    const view = editor._tiptapEditor?.view;
    if (!view) return;
    const tryScroll = (attempt: number) => {
      if (scrollToCommentRange(view, commentAnchors, id)) return;
      if (attempt >= 8) return;
      window.setTimeout(() => tryScroll(attempt + 1), 50 * (attempt + 1));
    };
    requestAnimationFrame(() => tryScroll(0));
  }, [path, editor, takePendingCommentFocus, commentAnchors]);

  const onSelectComment = useCallback(
    (id: string) => {
      setActiveCommentId(id);
      const view = editor._tiptapEditor?.view;
      if (!view) return;
      const tryScroll = (attempt: number) => {
        if (scrollToCommentRange(view, commentAnchors, id)) return;
        if (attempt >= 6) return;
        window.setTimeout(() => tryScroll(attempt + 1), 40 * (attempt + 1));
      };
      tryScroll(0);
    },
    [editor, commentAnchors],
  );

  const onDraftSubmit = useCallback(
    async (body: string) => {
      if (!draft) return;
      const created = await upsertActiveComment({
        quote: draft.quote,
        prefix: draft.prefix,
        suffix: draft.suffix,
        anchor: draft.anchor,
        body,
      });
      setDraft(null);
      if (created) setActiveCommentId(created.id);
    },
    [draft, upsertActiveComment],
  );

  const onCommentBodyChange = useCallback(
    async (id: string, body: string) => {
      const existing = activeNoteComments.find((c) => c.id === id);
      if (!existing) return;
      await upsertActiveComment({
        id: existing.id,
        quote: existing.quote,
        prefix: existing.prefix,
        suffix: existing.suffix,
        anchor: existing.anchor,
        body,
        resolved: existing.resolved,
      });
    },
    [activeNoteComments, upsertActiveComment],
  );

  const handleEmptyCanvasMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      if (
        focusLiveEditorFromEmptyClick(editor, {
          clientX: e.clientX,
          clientY: e.clientY,
          target: e.target,
        })
      ) {
        e.preventDefault();
      }
    },
    [editor],
  );

  const cutSelection = useCallback(async () => {
    const text = editor.getSelectedText();
    if (!text) return;
    await writeClipboardText(text);
    editor._tiptapEditor.commands.deleteSelection();
  }, [editor]);

  const copySelection = useCallback(async () => {
    const text = editor.getSelectedText();
    if (!text) return;
    await writeClipboardText(text);
  }, [editor]);

  const pasteAtCursor = useCallback(async () => {
    markPasteGestureHandled();
    if (await pasteImagesFromSystemClipboard(editor)) return;
    const text = await readTextFromSystemClipboard();
    if (text) {
      editor.pasteText(text);
      return;
    }
    if (await pasteImagesFromSystemClipboard(editor, 2)) return;
    warnClipboardImageMissing("Paste");
  }, [editor]);

  useEffect(() => {
    if (!isActive) return;
    const shell = shellRef.current;
    if (!shell) return;

    const overEditor = (target: EventTarget | null) =>
      Boolean(target && target instanceof Node && shell.contains(target));

    const clearDropCursor = () => {
      clearBlockNoteDropCursor(editor.prosemirrorView?.dom);
    };

    const onDragOver = (event: DragEvent) => {
      if (!overEditor(event.target)) return;
      const types = event.dataTransfer
        ? Array.from(event.dataTransfer.types as ArrayLike<string>)
        : [];
      const hasMime = types.includes(DRAWIO_TREE_MIME);
      if (!getActiveDrawioTreeDrag() && !hasMime) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const onDrop = (event: DragEvent) => {
      if (!overEditor(event.target)) return;
      const src = drawioPathFromDrop(event.dataTransfer);
      if (!src || !isDrawioPath(src)) return;
      event.preventDefault();
      event.stopPropagation();
      insertDrawioEmbed(editor, src, {
        x: event.clientX,
        y: event.clientY,
      });
      clearDrawioTreeDrag();
      clearDropCursor();
    };

    const onDragEnd = () => {
      if (!getActiveDrawioTreeDrag()) return;
      clearDropCursor();
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", onDragEnd, true);
    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", onDragEnd, true);
    };
  }, [editor, isActive]);

  // dnd-kit tree drag: no HTML5 dataTransfer — accept pointer drops via bridge event.
  useEffect(() => {
    if (!isActive) return;
    const onPointerDrop = (event: Event) => {
      const detail = (event as CustomEvent<VaultTreePointerDropDetail>).detail;
      if (!detail?.path) return;
      const shell = shellRef.current;
      if (!pointOverElement(shell, detail.clientX, detail.clientY)) return;
      event.preventDefault();
      const src = detail.path;
      if (isDrawioPath(src)) {
        insertDrawioEmbed(editor, src, {
          x: detail.clientX,
          y: detail.clientY,
        });
        clearDrawioTreeDrag();
        clearVaultTreeDrag();
        clearBlockNoteDropCursor(editor.prosemirrorView?.dom);
        return;
      }
      // Match old HTML5 text/plain path insertion into the live editor.
      editor.pasteText(src);
      clearVaultTreeDrag();
      clearBlockNoteDropCursor(editor.prosemirrorView?.dom);
    };
    window.addEventListener(
      VAULT_TREE_POINTER_DROP_EVENT,
      onPointerDrop as EventListener,
    );
    return () => {
      window.removeEventListener(
        VAULT_TREE_POINTER_DROP_EVENT,
        onPointerDrop as EventListener,
      );
    };
  }, [editor, isActive]);

  // BlockNote's SideMenu plugin listens for `mousemove` on `document` (capture
  // phase) *per editor instance* and, on every move, scans every mounted
  // `.bn-editor` for hit-testing — even ones that are warm-but-inactive and
  // hidden via `visibility: hidden`. With several Live tabs kept warm
  // (`useWarmLiveMarkdownPaths`), that multiplies the per-move cost, which is
  // felt as jank while dragging a multi-block selection or scrolling. Freeze
  // the side menu on inactive instances so their `mousemove` handler bails out
  // on its very first check; unfreeze when the tab becomes active again.
  // `freezeMenu`/`unfreezeMenu` can throw if the menu was never shown yet
  // (no prior hover), but they set the frozen flag before that — safe to
  // swallow.
  useEffect(() => {
    const sideMenu = editor.getExtension(SideMenuExtension);
    if (!sideMenu) return;
    try {
      if (isActive) {
        sideMenu.unfreezeMenu();
      } else {
        sideMenu.freezeMenu();
      }
    } catch {
      // No side menu state yet for this instance — frozen flag is already set.
    }
  }, [editor, isActive]);

  return (
    <div
      ref={shellRef}
      className={[
        "editor-shell",
        showOutline ? "editor-shell--with-outline" : "",
        showComments ? "editor-shell--with-comments" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleLinkClick}
      onDoubleClick={handleImageDoubleClick}
    >
      {showOutline ? (
        <>
          <DocumentOutline
            editor={editor}
            width={outlineWidth}
            notePath={path}
            vaultPath={vaultPath}
          />
          <div
            className="app-splitter outline-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize outline"
            aria-valuenow={outlineWidth}
            aria-valuemin={OUTLINE_WIDTH_MIN}
            aria-valuemax={OUTLINE_WIDTH_MAX}
            tabIndex={0}
            onPointerDown={onOutlineSplitterPointerDown}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const delta = e.key === "ArrowRight" ? 16 : -16;
              setOutlineWidth((w) => {
                const next = clampOutlineWidth(w + delta);
                persistOutlineWidth(next);
                return next;
              });
            }}
          />
        </>
      ) : null}
      <div className="editor-column">
        {/* DocumentToolbar lives in MainPane (above editor slots) so Live
            keep-alive does not paint a second path / Live|Source row in Source. */}
        <div
          className="editor-main"
          ref={setEditorMainEl}
          onMouseDown={handleEmptyCanvasMouseDown}
        >
          <div className="editor-canvas-wrap">
            <div
              className="editor-canvas"
              style={
                {
                  "--live-font-size": `${canvasLiveFontSize}px`,
                } as CSSProperties
              }
              onContextMenu={openEditorContextMenu}
            >
              <NotePageChrome path={path} content={content} onChange={onChange} />
              <NoteFormattingToolbarProvider
                notePath={path}
                onComment={startCommentFromSelection}
                onCapture={startCaptureFromSelection}
                onInsertNoteLink={openWikiLinkPicker}
              >
                <BlockNoteView
                  editor={editor}
                  theme={editorTheme}
                  slashMenu={false}
                  formattingToolbar={false}
                  sideMenu={false}
                >
                  <SideMenuController sideMenu={NoteSideMenu} />
                  <FormattingToolbarController
                    formattingToolbar={NoteFormattingToolbar}
                  />
                  <SuggestionMenuController
                    triggerCharacter="/"
                    getItems={getSlashMenuItems}
                    suggestionMenuComponent={NoteSlashSuggestionMenu}
                    floatingUIOptions={suggestionMenuFloatingOptions}
                  />
                  <SuggestionMenuController
                    triggerCharacter="#"
                    getItems={getHashTagMenuItems}
                    shouldOpen={shouldOpenTagMenu}
                    suggestionMenuComponent={TagSuggestionMenu}
                    floatingUIOptions={suggestionMenuFloatingOptions}
                    onItemClick={(item) => {
                      item.onItemClick?.();
                    }}
                  />
                </BlockNoteView>
              </NoteFormattingToolbarProvider>
            </div>
          </div>
        </div>
      </div>
      {showComments ? (
        <>
          <div
            className="app-splitter comments-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize comments"
            aria-valuenow={commentsWidth}
            aria-valuemin={COMMENTS_WIDTH_MIN}
            aria-valuemax={COMMENTS_WIDTH_MAX}
            tabIndex={0}
            onPointerDown={onCommentsSplitterPointerDown}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const delta = e.key === "ArrowLeft" ? 16 : -16;
              setCommentsWidth((w) => {
                const next = clampCommentsWidth(w + delta);
                persistCommentsWidth(next);
                return next;
              });
            }}
          />
          <CommentsPanel
            width={commentsWidth}
            notePath={path}
            comments={commentsInDocOrder}
            activeId={activeCommentId}
            showResolved={showResolvedComments}
            drafting={draft != null}
            draftQuote={draft?.quote ?? ""}
            shellRef={shellRef}
            layoutTick={commentLayoutTick + commentsWidth}
            onShowResolvedChange={setShowResolvedComments}
            onSelect={onSelectComment}
            onResolve={(id, resolved) => {
              void setActiveCommentResolved(id, resolved);
            }}
            onDelete={(id) => {
              void deleteActiveComment(id);
              if (activeCommentId === id) setActiveCommentId(null);
            }}
            onBodyChange={(id, body) => {
              void onCommentBodyChange(id, body);
            }}
            onDraftSubmit={(body) => {
              void onDraftSubmit(body);
            }}
            onDraftCancel={() => setDraft(null)}
          />
        </>
      ) : null}
      {showComments && visibleConnectorIds.length > 0 ? (
        <CommentConnectors
          shellRef={shellRef}
          commentIds={visibleConnectorIds}
          activeId={activeCommentId}
          resolvedById={resolvedById}
          layoutTick={commentLayoutTick + commentsWidth}
        />
      ) : null}
      {viewedImage ? (
        <ImageLightbox
          src={viewedImage.src}
          alt={viewedImage.alt}
          onClose={() => setViewedImage(null)}
        />
      ) : null}
      <WikiLinkPickerDialog
        open={wikiLinkPicker != null}
        initialLabel={wikiLinkPicker?.initialLabel ?? ""}
        revealPath={path}
        onCancel={() => setWikiLinkPicker(null)}
        onConfirm={confirmWikiLink}
      />
      {contextMenu ? (
        <EditContextMenu
          menu={contextMenu}
          onClose={closeContextMenu}
          onCut={() => void cutSelection()}
          onCopy={() => void copySelection()}
          onPaste={() => void pasteAtCursor()}
          onComment={startCommentFromSelection}
          onCapture={startCaptureFromSelection}
        />
      ) : null}
    </div>
  );
});
