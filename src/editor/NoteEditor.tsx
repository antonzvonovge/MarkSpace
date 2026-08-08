import "@blocknote/mantine/style.css";
import "katex/dist/katex.min.css";

import { VALID_LINK_PROTOCOLS } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import type { Theme } from "@blocknote/mantine";
import {
  SuggestionMenuController,
  useCreateBlockNote,
  useEditorChange,
} from "@blocknote/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
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
import { PageTags } from "../components/PageTags";
import { writeClipboardText } from "../lib/clipboardText";
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
} from "../lib/vaultApi";
import { isUnderDiaryProject } from "../lib/diaryNotes";
import { editorFontStack } from "../settings/applyPrefs";
import type { ThemeId } from "../settings/types";
import { usePrefsStore } from "../store/prefsStore";
import { useVaultStore } from "../store/vaultStore";
import { createLayoutAgnosticKeymapExtension } from "./layoutAgnosticKeymap";
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
};

export function NoteEditor({ path, content, onChange }: Props) {
  const openNote = useVaultStore((s) => s.openNote);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const showOutline = useVaultStore((s) => s.showOutline);
  const showComments = useVaultStore((s) => s.showComments);
  const activeNoteComments = useVaultStore((s) => s.activeNoteComments);
  const upsertActiveComment = useVaultStore((s) => s.upsertActiveComment);
  const deleteActiveComment = useVaultStore((s) => s.deleteActiveComment);
  const setActiveCommentResolved = useVaultStore(
    (s) => s.setActiveCommentResolved,
  );
  const takePendingCommentFocus = useVaultStore(
    (s) => s.takePendingCommentFocus,
  );
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
      target.setPointerCapture(event.pointerId);
      target.classList.add("is-active");

      const onMove = (ev: PointerEvent) => {
        setOutlineWidth(clampOutlineWidth(startWidth + (ev.clientX - startX)));
      };
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.classList.remove("is-active");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setOutlineWidth((w) => {
          persistOutlineWidth(w);
          return w;
        });
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
      target.setPointerCapture(event.pointerId);
      target.classList.add("is-active");

      const onMove = (ev: PointerEvent) => {
        // Dragging left grows the panel (splitter is on the left edge).
        setCommentsWidth(
          clampCommentsWidth(startWidth - (ev.clientX - startX)),
        );
      };
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.classList.remove("is-active");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setCommentsWidth((w) => {
          persistCommentsWidth(w);
          return w;
        });
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

  const editor = useCreateBlockNote(
    {
      schema: noteEditorSchema,
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
      _tiptapOptions: {
        extensions: [
          layoutKeymap,
          selectAtomAfterDrop,
          hashtagDecorations,
          codeBlockCopy,
          commentDecorations,
        ],
      },
    },
    [path],
  );
  editorRef.current = editor;

  useEditorChange((ed) => {
    let md = applyImagePreviewWidths(
      ed.blocksToMarkdownLossy(),
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
    onChange(full);
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

    const body = noteBody(normalizeMarkdown(content));
    const bodyChanged = pathChanged || body !== lastBodyRef.current;
    if (!bodyChanged) return;

    applyingRef.current = true;
    // Strip any leftover Live HTML tag spans from older builds; keep `#tag` as text.
    // Project `$…$` / `$$…$$` into BlockNote math HTML before parse.
    const blocks = restoreImagePreviewWidthsFromAlt(
      editor.tryParseMarkdownToBlocks(
        mathToEditorMarkdown(editorMarkdownToHashtags(wikiToMarkdown(body))),
      ),
    );
    editor.replaceBlocks(editor.document, blocks);
    lastBodyRef.current = body;
    adoptNextChangeRef.current = true;
    // replaceBlocks may notify listeners after this tick.
    queueMicrotask(() => {
      applyingRef.current = false;
      queueMicrotask(() => {
        adoptNextChangeRef.current = false;
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
            resolved = await createNote(wikiTarget);
            await refreshTree();
          } else {
            const folder = folderPathFromFolderNote(resolved);
            if (folder) {
              resolved = await ensureFolderNote(folder);
            }
          }
          await go(resolved);
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
    const view = editor._tiptapEditor?.view;
    if (!view) return;
    setCommentDecorationsMeta(view, {
      comments: commentAnchors,
      showResolved: showResolvedComments,
      activeId: activeCommentId,
    });
  }, [editor, commentAnchors, showResolvedComments, activeCommentId]);

  const [commentLayoutTick, setCommentLayoutTick] = useState(0);
  useEffect(() => {
    if (!showComments) return;
    const tip = editor._tiptapEditor;
    if (!tip) return;
    const bump = () => setCommentLayoutTick((n) => n + 1);
    tip.on("transaction", bump);
    // After decorations meta applies, remount measures need a frame.
    requestAnimationFrame(bump);
    return () => {
      tip.off("transaction", bump);
    };
  }, [editor, showComments, path, commentAnchors, showResolvedComments]);

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
  }, [editor]);

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
        <DocumentToolbar />
        <div className="editor-main" onMouseDown={handleEmptyCanvasMouseDown}>
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
              <PageTags content={content} onChange={onChange} />
              <BlockNoteView
                editor={editor}
                theme={editorTheme}
                slashMenu={false}
              >
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
}
