import "@blocknote/mantine/style.css";
import "katex/dist/katex.min.css";

import { VALID_LINK_PROTOCOLS } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import type { Theme } from "@blocknote/mantine";
import {
  FormattingToolbarController,
  SuggestionMenuController,
  useCreateBlockNote,
  useEditorChange,
} from "@blocknote/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import { DocumentToolbar } from "../components/DocumentToolbar";
import {
  EditContextMenu,
  type EditContextMenuState,
} from "../components/EditContextMenu";
import { ImageLightbox } from "../components/ImageLightbox";
import { NotePageChrome } from "../components/NotePageChrome";
import { writeClipboardText } from "../lib/clipboardText";
import { registerLiveEditor } from "./completedTasksCommand";
import { registerLiveEditorFlush } from "./liveEditorFlush";
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
import { editorFontStack } from "../settings/applyPrefs";
import type { ThemeId } from "../settings/types";
import { usePrefsStore } from "../store/prefsStore";
import { isIncomingTab, useVaultStore } from "../store/vaultStore";
import { createLayoutAgnosticKeymapExtension } from "./layoutAgnosticKeymap";
import { createListOnlyNestingExtension } from "./listOnlyNesting";
import { NoteSlashSuggestionMenu } from "./NoteSlashSuggestionMenu";
import {
  createImagePasteHandler,
  markPasteGestureHandled,
  pasteImagesFromSystemClipboard,
  readTextFromSystemClipboard,
  warnClipboardImageMissing,
} from "./pasteImages";
import { noteEditorSchema } from "./schema";
import { createSelectAtomBlockAfterDropExtension } from "./selectAtomBlockAfterDrop";
import { getNoteSlashMenuItems } from "./slashMenuItems";
import { insertDrawioEmbed } from "./drawio/slashItem";
import {
  clearBlockNoteDropCursor,
  clearDrawioTreeDrag,
  DRAWIO_TREE_MIME,
  drawioPathFromDrop,
  getActiveDrawioTreeDrag,
} from "./drawio/treeDrag";
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
        background: "rgba(203, 17, 171, 0.12)",
      },
      selected: {
        text: dark ? "#e7eef2" : "#1c2428",
        background: "rgba(203, 17, 171, 0.18)",
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
    const tab = s.tabs.find((t) => t.path === s.activePath);
    if (tab && isIncomingTab(tab)) return false;
    return s.showOutline;
  });
  const showComments = useVaultStore((s) => {
    if (!isActive) return false;
    const tab = s.tabs.find((t) => t.path === s.activePath);
    if (tab && isIncomingTab(tab)) return false;
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

  const emitSerializedMarkdown = useCallback(
    (ed: typeof editor) => {
      let md = applyImagePreviewWidths(
        nestedHtmlToMarkdown(ed.blocksToHTMLLossy(ed.document)),
        collectImageSizeRefs(ed.document),
      );
      md = applyColoredTableHtml(
        md,
        projectColoredTables(ed.document, (blocks) =>
          ed.blocksToHTMLLossy(blocks as typeof ed.document),
        ),
      );
      const wikiMd = markdownToWiki(
        editorMarkdownToMath(editorMarkdownToHashtags(md)),
      );
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
    [editor],
  );

  const flushSerialize = useCallback(() => {
    cancelScheduledSerialize();
    if (!pendingSerializeRef.current) return;
    pendingSerializeRef.current = false;
    const ed = editorRef.current;
    if (!ed) return;
    emitSerializedMarkdown(ed);
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
      if (ed) emitSerializedMarkdown(ed);
    };
  }, [editor, emitSerializedMarkdown, cancelScheduledSerialize]);

  useEditorChange((ed) => {
    if (isActiveRef.current) refreshDocumentFindIfOpen();
    // Load/replaceBlocks must adopt serialization synchronously.
    if (applyingRef.current || adoptNextChangeRef.current) {
      cancelScheduledSerialize();
      pendingSerializeRef.current = false;
      emitSerializedMarkdown(ed);
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
        if (current) emitSerializedMarkdown(current);
      }, LIVE_SERIALIZE_IDLE_TIMEOUT_MS);
    }, LIVE_SERIALIZE_MS);
  }, editor);

  const getSlashMenuItems = useCallback(
    async (query: string) => getNoteSlashMenuItems(editor, query, path),
    [editor, path],
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
            : openNote(path);

        if (isWikiHref(href)) {
          const wikiTarget = wikiTargetFromHref(href);
          let resolved = await resolveWikiTarget(wikiTarget);
          if (!resolved) {
            // Specialized vault docs must already exist — never invent a .md sibling.
            if (/\.(mddict|mdlnks|mdhabit|drawio|pdf)$/i.test(wikiTarget.trim())) {
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
        {/* Editor chrome stays mounted for keep-alive tabs: toggling
            `editable` or the controllers makes BlockNote re-mount the
            ProseMirror view on every tab switch. */}
        <DocumentToolbar />
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
              >
                <BlockNoteView
                  editor={editor}
                  theme={editorTheme}
                  slashMenu={false}
                  formattingToolbar={false}
                >
                  <FormattingToolbarController
                    formattingToolbar={NoteFormattingToolbar}
                  />
                  <SuggestionMenuController
                    triggerCharacter="/"
                    getItems={getSlashMenuItems}
                    suggestionMenuComponent={NoteSlashSuggestionMenu}
                  />
                  <SuggestionMenuController
                    triggerCharacter="#"
                    getItems={getHashTagMenuItems}
                    shouldOpen={shouldOpenTagMenu}
                    suggestionMenuComponent={TagSuggestionMenu}
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
      {contextMenu ? (
        <EditContextMenu
          menu={contextMenu}
          onClose={closeContextMenu}
          onCut={() => void cutSelection()}
          onCopy={() => void copySelection()}
          onPaste={() => void pasteAtCursor()}
          onComment={startCommentFromSelection}
        />
      ) : null}
    </div>
  );
});
