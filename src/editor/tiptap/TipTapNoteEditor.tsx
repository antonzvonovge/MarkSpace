import "katex/dist/katex.min.css";

import { openUrl } from "@tauri-apps/plugin-opener";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
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
import { CommentsPanel } from "../../components/CommentsPanel";
import { CommentConnectors } from "../../components/CommentConnectors";
import { DocumentOutline } from "../../components/DocumentOutline";
import {
  EditContextMenu,
  type EditContextMenuState,
} from "../../components/EditContextMenu";
import { ImageLightbox } from "../../components/ImageLightbox";
import { NotePageChrome } from "../../components/NotePageChrome";
import {
  WikiLinkPickerDialog,
  type WikiLinkPickerResult,
} from "../../components/WikiLinkPickerDialog";
import { decorateBrokenVaultLinks } from "../../lib/brokenLinks";
import { writeClipboardText } from "../../lib/clipboardText";
import type { CommentAnchor } from "../../lib/commentAnchors";
import {
  captureCommentAnchor,
  findCommentRanges,
  sortCommentsByDocumentOrder,
  type StructuralAnchor,
} from "../../lib/commentAnchors";
import {
  clampCommentsWidth,
  loadDocCommentsUi,
  saveDocCommentsWidth,
  COMMENTS_WIDTH_MIN,
  COMMENTS_WIDTH_MAX,
} from "../../lib/commentsUiState";
import { isUnderDiaryProject } from "../../lib/diaryNotes";
import { editorMarkdownToHashtags } from "../../lib/hashtagMarkdown";
import { applyImagePreviewWidths } from "../../lib/imageMarkdown";
import {
  editorMarkdownToMath,
  mathToEditorMarkdown,
} from "../../lib/mathMarkdown";
import { normalizeMarkdown } from "../../lib/normalizeMarkdown";
import { noteBody, withNoteBody } from "../../lib/noteFrontmatter";
import {
  clampOutlineWidth,
  loadDocOutlineUi,
  saveDocOutlineWidth,
  OUTLINE_WIDTH_MIN,
  OUTLINE_WIDTH_MAX,
} from "../../lib/outlineUiState";
import { applyColoredTableHtml } from "../../lib/tableMarkdown";
import {
  createNote,
  ensureFolderNote,
  folderPathFromFolderNote,
  isDrawioPath,
  resolveWikiTarget,
  writeAsset,
  type NoteComment,
} from "../../lib/vaultApi";
import {
  clearVaultTreeDrag,
  pointOverElement,
  VAULT_TREE_POINTER_DROP_EVENT,
  type VaultTreePointerDropDetail,
} from "../../lib/vaultTreeDrag";
import {
  isExternalHref,
  isWikiHref,
  markdownToWiki,
  wikiTargetFromHref,
  wikiToMarkdown,
} from "../../lib/wikiMarkdown";
import { usePersistedEditorScroll } from "../../hooks/usePersistedEditorScroll";
import { editorFontStack } from "../../settings/applyPrefs";
import { usePrefsStore } from "../../store/prefsStore";
import { openCaptureDialog } from "../../store/captureStore";
import { useVaultStore } from "../../store/vaultStore";
import { registerLiveEditor } from "../completedTasksCommand";
import {
  createCommentDecorationExtension,
  getCommentRanges,
  scrollToCommentRange,
  setCommentDecorationsMeta,
} from "../comment/commentDecorations";
import { createCodeBlockCopyExtension } from "../codeBlockCopy";
import {
  clearDrawioTreeDrag,
  DRAWIO_TREE_MIME,
  drawioPathFromDrop,
  getActiveDrawioTreeDrag,
} from "../drawio/treeDrag";
import { refreshDocumentFindIfOpen } from "../find/documentFindController";
import { createFindDecorationExtension } from "../find/findDecorations";
import { registerLiveEditorFlush } from "../liveEditorFlush";
import {
  markPasteGestureHandled,
  collectImageFilesFromPaste,
  readImagesFromSystemClipboard,
  readTextFromSystemClipboard,
  warnClipboardImageMissing,
} from "../pasteImages";
import { createHashtagDecorationExtension } from "../tag/tagDecorations";
import { createTiptapLayoutAgnosticKeymap } from "./layoutAgnosticKeymap";
import { focusTiptapEditorFromEmptyClick } from "./focusTiptapEditor";
import { markdownToEditorHtml, editorHtmlToMarkdown } from "./markdownBridge";
import { createNoteTiptapExtensions } from "./noteExtensions";
import {
  applyImageWidthsFromAltInEditor,
  collectImageSizeRefsFromTiptap,
  projectColoredTablesFromTiptap,
} from "./serializeHelpers";

const LIVE_SERIALIZE_MS = 1_000;
const LIVE_SERIALIZE_IDLE_TIMEOUT_MS = 1_000;

type IdleHandle =
  | { kind: "idle"; id: number }
  | { kind: "timeout"; id: number };

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

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
  /** False for keep-alive hidden tabs — skip chrome, listeners, comment work. */
  isActive?: boolean;
};

export const TipTapNoteEditor = memo(function TipTapNoteEditor({
  path,
  content,
  onChange,
  isActive = true,
}: Props) {
  const openNote = useVaultStore((s) => s.openNote);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const markDirty = useVaultStore((s) => s.markDirty);
  const vaultPath = useVaultStore((s) => s.vaultPath);
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
  const lastExternalRef = useRef(content);
  const frontmatterBaseRef = useRef(content);
  const lastBodyRef = useRef(noteBody(content));
  const notePathRef = useRef(path);
  notePathRef.current = path;
  const editorRef = useRef<Editor | null>(null);

  const [viewedImage, setViewedImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
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
  const [contextMenu, setContextMenu] = useState<EditContextMenuState | null>(
    null,
  );
  const shellRef = useRef<HTMLDivElement>(null);

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

  const onAnchorsChangedRef = useRef<
    | ((
        updates: import("../../lib/commentAnchors").CommentAnchorUpdate[],
      ) => void)
    | undefined
  >(undefined);

  const layoutKeymap = useMemo(
    () =>
      createTiptapLayoutAgnosticKeymap({
        getEditor: () => editorRef.current,
        getNotePath: () => notePathRef.current,
      }),
    [],
  );
  const hashtagDecorations = useMemo(
    () => createHashtagDecorationExtension(),
    [],
  );
  const codeBlockCopy = useMemo(() => createCodeBlockCopyExtension(), []);
  const commentDecorations = useMemo(
    () =>
      createCommentDecorationExtension({
        getOnAnchorsChanged: () => onAnchorsChangedRef.current,
      }),
    [],
  );
  const findDecorations = useMemo(() => createFindDecorationExtension(), []);

  const extensions = useMemo(
    () =>
      createNoteTiptapExtensions({
        path,
        extraExtensions: [
          layoutKeymap,
          hashtagDecorations,
          codeBlockCopy,
          commentDecorations,
          findDecorations,
        ],
      }),
    [
      path,
      layoutKeymap,
      hashtagDecorations,
      codeBlockCopy,
      commentDecorations,
      findDecorations,
    ],
  );

  const editor = useEditor(
    {
      extensions,
      content: "",
      editable: isActive,
      editorProps: {
        attributes: {
          class: "bn-editor ProseMirror",
          spellcheck: "false",
          style: `font-family: ${editorFontStack(liveFontFamily)}`,
        },
        handlePaste(_view, event) {
          const dt = event.clipboardData;
          if (!dt) return false;
          const files = collectImageFilesFromPaste(dt);
          if (!files.length) return false;
          event.preventDefault();
          markPasteGestureHandled();
          const ed = editorRef.current;
          if (!ed) return true;
          void (async () => {
            for (const file of files) {
              const name = file.name?.trim() || "image.png";
              const bytes = new Uint8Array(await file.arrayBuffer());
              try {
                const url = await writeAsset(notePathRef.current, name, bytes);
                ed
                  .chain()
                  .focus()
                  .insertContent({
                    type: "image",
                    attrs: { src: url, alt: "" },
                  })
                  .run();
              } catch (err) {
                console.error("Failed to paste image", err);
              }
            }
          })();
          return true;
        },
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

  const emitSerializedMarkdown = useCallback((ed: Editor) => {
    const html = ed.getHTML();
    let base = editorHtmlToMarkdown(html);
    base = applyImagePreviewWidths(
      base,
      collectImageSizeRefsFromTiptap(ed),
    );
    base = applyColoredTableHtml(
      base,
      projectColoredTablesFromTiptap(ed),
    );
    const wikiMd = markdownToWiki(
      editorMarkdownToMath(editorMarkdownToHashtags(base)),
    );
    const full = withNoteBody(frontmatterBaseRef.current, wikiMd);

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
  }, []);

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
    if (!editor) return;
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

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(isActive);
  }, [editor, isActive]);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (isActiveRef.current) refreshDocumentFindIfOpen();
      if (applyingRef.current || adoptNextChangeRef.current) {
        cancelScheduledSerialize();
        pendingSerializeRef.current = false;
        emitSerializedMarkdown(editor);
        return;
      }
      if (!isActiveRef.current) return;
      pendingSerializeRef.current = true;
      markDirty();
      cancelScheduledSerialize();
      serializeTimerRef.current = window.setTimeout(() => {
        serializeTimerRef.current = null;
        if (!pendingSerializeRef.current) return;
        idleHandleRef.current = scheduleIdle(() => {
          idleHandleRef.current = null;
          if (!pendingSerializeRef.current) return;
          pendingSerializeRef.current = false;
          const current = editorRef.current;
          if (current) emitSerializedMarkdown(current);
        }, LIVE_SERIALIZE_IDLE_TIMEOUT_MS);
      }, LIVE_SERIALIZE_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, markDirty, emitSerializedMarkdown, cancelScheduledSerialize]);

  useEffect(() => {
    if (!editor) return;
    const pathChanged = lastPathRef.current !== path;
    const externalChange = content !== lastExternalRef.current;
    if (!pathChanged && !externalChange) return;

    frontmatterBaseRef.current = content;
    lastExternalRef.current = content;
    lastPathRef.current = path;

    const body = noteBody(normalizeMarkdown(content));
    const prevBody = normalizeMarkdown(lastBodyRef.current);
    const bodyChanged = pathChanged || body !== prevBody;
    if (!bodyChanged) {
      lastBodyRef.current = body;
      return;
    }

    const scroller =
      (editor.view.dom.closest(".editor-main") as HTMLElement | null) ?? null;
    const scrollTop = scroller?.scrollTop ?? 0;

    applyingRef.current = true;
    const projected = mathToEditorMarkdown(
      editorMarkdownToHashtags(wikiToMarkdown(body)),
    );
    const html = markdownToEditorHtml(projected);
    editor.commands.setContent(html, { emitUpdate: false });
    applyImageWidthsFromAltInEditor(editor);
    lastBodyRef.current = body;
    adoptNextChangeRef.current = true;
    queueMicrotask(() => {
      applyingRef.current = false;
      if (scroller) scroller.scrollTop = scrollTop;
      queueMicrotask(() => {
        adoptNextChangeRef.current = false;
        if (scroller) scroller.scrollTop = scrollTop;
      });
    });
  }, [editor, path, content]);

  const selectedText = useCallback((ed: Editor) => {
    const { from, to } = ed.state.selection;
    if (from === to) return "";
    return ed.state.doc.textBetween(from, to, " ");
  }, []);

  const openWikiLinkPicker = useCallback(
    (opts?: { from?: number; to?: number; initialLabel?: string }) => {
      if (!editor) return;
      const sel = editor.state.selection;
      const from = opts?.from ?? sel.from;
      const to = opts?.to ?? sel.to;
      const initialLabel =
        opts?.initialLabel ?? selectedText(editor).trim() ?? "";
      wikiLinkSelRef.current = { from, to };
      setWikiLinkPicker({ initialLabel });
    },
    [editor, selectedText],
  );

  const confirmWikiLink = useCallback(
    (result: WikiLinkPickerResult) => {
      if (!editor) return;
      const href = `wiki:${encodeURIComponent(result.target)}`;
      const bookmark = wikiLinkSelRef.current;
      wikiLinkSelRef.current = null;
      setWikiLinkPicker(null);

      if (bookmark) {
        try {
          const max = editor.state.doc.content.size;
          const from = Math.max(0, Math.min(bookmark.from, max));
          const to = Math.max(0, Math.min(bookmark.to, max));
          editor.view.dispatch(
            editor.state.tr.setSelection(
              TextSelection.create(editor.state.doc, from, to),
            ),
          );
        } catch {
          /* doc changed while dialog was open */
        }
      }

      const label = result.label || result.target;
      editor
        .chain()
        .focus()
        .insertContent(`<a href="${href}">${label}</a>`)
        .run();
    },
    [editor],
  );

  const handleLinkClick = useCallback(
    (event: React.MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      const openPinned = event.ctrlKey || event.metaKey;

      void (async () => {
        const go = (notePath: string) =>
          openPinned
            ? openNote(notePath, { preview: false })
            : openNote(notePath, { replaceActive: true });

        if (isWikiHref(href)) {
          const wikiTarget = wikiTargetFromHref(href);
          let resolved = await resolveWikiTarget(wikiTarget);
          if (!resolved) {
            if (
              /\.(mddict|mdlnks|mdhabit|mdcourse|drawio|pdf)$/i.test(
                wikiTarget.trim(),
              )
            ) {
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
        let resolved = await resolveWikiTarget(
          cleanedHref.replace(/\.md$/i, ""),
        );
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
    if (!target.matches("img.bn-visual-media, .bn-editor img")) return;
    const src = target.currentSrc || target.src;
    if (!src) return;
    event.preventDefault();
    event.stopPropagation();
    setViewedImage({ src, alt: target.alt });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openEditorContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      if (!editor) return;
      e.preventDefault();
      e.stopPropagation();
      const selected = selectedText(editor);
      const sel = editor.state.selection;
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        canCut: selected.length > 0,
        canCopy: selected.length > 0,
        canPaste: true,
        showComment: !sel.empty,
        showCapture: !sel.empty,
      });
    },
    [editor, selectedText],
  );

  const startCommentFromSelection = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const captured = captureCommentAnchor(editor.state.doc, from, to);
    if (!captured) return;
    setDraft(captured);
    if (!useVaultStore.getState().showComments) {
      useVaultStore.getState().toggleComments();
    }
  }, [editor]);

  const startCaptureFromSelection = useCallback(() => {
    if (!editor) return;
    const text = selectedText(editor).trim();
    openCaptureDialog({
      quote: text || undefined,
      sourcePath: path,
    });
  }, [editor, path, selectedText]);

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
    Map<string, import("../../lib/commentAnchors").CommentAnchorUpdate>
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
    if (!isActive || !editor) return;
    setCommentDecorationsMeta(editor.view, {
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
    if (!isActive || !showComments || !editor) return;
    let raf = 0;
    const bump = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setCommentLayoutTick((n) => n + 1);
      });
    };
    editor.on("transaction", bump);
    raf = requestAnimationFrame(() => {
      raf = 0;
      setCommentLayoutTick((n) => n + 1);
    });
    return () => {
      editor.off("transaction", bump);
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
    if (!editor) return activeNoteComments;
    let ranges = getCommentRanges(editor.view);
    if (ranges.length === 0 && commentAnchors.length > 0) {
      ranges = findCommentRanges(editor.state.doc, commentAnchors);
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
    if (!editor) return;
    setCommentDecorationsMeta(editor.view, {
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
  }, [vaultPath, path, editor]);

  useEffect(() => {
    if (!editor) return;
    const pending = useVaultStore.getState().pendingCommentFocusId;
    if (!pending) return;
    if (!commentAnchors.some((c) => c.id === pending)) return;
    const id = takePendingCommentFocus();
    if (!id) return;
    setActiveCommentId(id);
    if (!useVaultStore.getState().showComments) {
      useVaultStore.getState().toggleComments();
    }
    const view = editor.view;
    const tryScroll = (attempt: number) => {
      if (scrollToCommentRange(view, commentAnchors, id)) return;
      if (attempt >= 8) return;
      window.setTimeout(() => tryScroll(attempt + 1), 50 * (attempt + 1));
    };
    requestAnimationFrame(() => tryScroll(0));
  }, [path, editor, takePendingCommentFocus, commentAnchors]);

  const onSelectComment = useCallback(
    (id: string) => {
      if (!editor) return;
      setActiveCommentId(id);
      const view = editor.view;
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
      if (!editor || e.button !== 0) return;
      if (
        focusTiptapEditorFromEmptyClick(editor, {
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
    if (!editor) return;
    const text = selectedText(editor);
    if (!text) return;
    await writeClipboardText(text);
    editor.commands.deleteSelection();
  }, [editor, selectedText]);

  const copySelection = useCallback(async () => {
    if (!editor) return;
    const text = selectedText(editor);
    if (!text) return;
    await writeClipboardText(text);
  }, [editor, selectedText]);

  const pasteAtCursor = useCallback(async () => {
    if (!editor) return;
    markPasteGestureHandled();
    const files = await readImagesFromSystemClipboard();
    if (files.length > 0) {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const name = file.name?.trim() || "clipboard.png";
        const url = await writeAsset(notePathRef.current, name, bytes);
        editor
          .chain()
          .focus()
          .insertContent({ type: "image", attrs: { src: url, alt: "" } })
          .run();
      }
      return;
    }
    const text = await readTextFromSystemClipboard();
    if (text) {
      editor.chain().focus().insertContent(text).run();
      return;
    }
    const retry = await readImagesFromSystemClipboard(2);
    if (retry.length > 0) {
      for (const file of retry) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const name = file.name?.trim() || "clipboard.png";
        const url = await writeAsset(notePathRef.current, name, bytes);
        editor
          .chain()
          .focus()
          .insertContent({ type: "image", attrs: { src: url, alt: "" } })
          .run();
      }
      return;
    }
    warnClipboardImageMissing("Paste");
  }, [editor]);

  // Draw.io tree drag → insert wiki embed markdown.
  useEffect(() => {
    if (!isActive || !editor) return;
    const shell = shellRef.current;
    if (!shell) return;

    const overEditor = (target: EventTarget | null) =>
      Boolean(target && target instanceof Node && shell.contains(target));

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
      editor
        .chain()
        .focus()
        .insertContent(`![[${src}]]`)
        .run();
      clearDrawioTreeDrag();
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, [editor, isActive]);

  useEffect(() => {
    if (!isActive || !editor) return;
    const onPointerDrop = (event: Event) => {
      const detail = (event as CustomEvent<VaultTreePointerDropDetail>).detail;
      if (!detail?.path) return;
      const shell = shellRef.current;
      if (!pointOverElement(shell, detail.clientX, detail.clientY)) return;
      event.preventDefault();
      const src = detail.path;
      if (isDrawioPath(src)) {
        editor.chain().focus().insertContent(`![[${src}]]`).run();
        clearDrawioTreeDrag();
        clearVaultTreeDrag();
        return;
      }
      editor.chain().focus().insertContent(src).run();
      clearVaultTreeDrag();
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

  if (!editor) return null;

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
              <div className="bn-container">
                <EditorContent editor={editor} />
              </div>
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
