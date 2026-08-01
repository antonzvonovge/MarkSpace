import "@blocknote/mantine/style.css";

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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentOutline } from "../components/DocumentOutline";
import { DocumentToolbar } from "../components/DocumentToolbar";
import { PageTags } from "../components/PageTags";
import {
  editorMarkdownToHashtags,
} from "../lib/hashtagMarkdown";
import {
  applyImagePreviewWidths,
  collectImageSizeRefs,
  restoreImagePreviewWidthsFromAlt,
} from "../lib/imageMarkdown";
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
  isDrawioPath,
  joinPath,
  parentPath,
  resolveWikiTarget,
  writeAsset,
} from "../lib/vaultApi";
import { editorFontStack } from "../settings/applyPrefs";
import type { ThemeId } from "../settings/types";
import { usePrefsStore } from "../store/prefsStore";
import { useVaultStore } from "../store/vaultStore";
import { createLayoutAgnosticKeymapExtension } from "./layoutAgnosticKeymap";
import { NoteSlashSuggestionMenu } from "./NoteSlashSuggestionMenu";
import { createImagePasteHandler } from "./pasteImages";
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
import { createHashtagDecorationExtension } from "./tag/tagDecorations";
import { getTagMenuItems, shouldOpenTagMenu } from "./tag/tagSuggestion";
import { TagSuggestionMenu } from "./tag/TagSuggestionMenu";
import {
  clampOutlineWidth,
  loadDocOutlineUi,
  saveDocOutlineWidth,
  OUTLINE_WIDTH_MIN,
  OUTLINE_WIDTH_MAX,
} from "../lib/outlineUiState";

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
  const theme = usePrefsStore((s) => s.prefs.theme);
  const liveFontFamily = usePrefsStore((s) => s.prefs.liveFontFamily);
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
  const [outlineWidth, setOutlineWidth] = useState(
    () => loadDocOutlineUi(vaultPath, path).width,
  );

  const persistOutlineWidth = useCallback(
    (width: number) => {
      saveDocOutlineWidth(vaultPath, path, width);
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
        extensions: [layoutKeymap, selectAtomAfterDrop, hashtagDecorations],
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
    const wikiMd = markdownToWiki(editorMarkdownToHashtags(md));
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
    const blocks = restoreImagePreviewWidthsFromAlt(
      editor.tryParseMarkdownToBlocks(
        editorMarkdownToHashtags(wikiToMarkdown(body)),
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

      void (async () => {
        if (isWikiHref(href)) {
          const wikiTarget = wikiTargetFromHref(href);
          let resolved = await resolveWikiTarget(wikiTarget);
          if (!resolved) {
            resolved = await createNote(wikiTarget);
            await refreshTree();
          }
          await openNote(resolved);
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
        if (resolved) await openNote(resolved);
      })();
    },
    [openNote, refreshTree],
  );

  // Tree DnD is scoped to the sidebar so HTML5Backend does not kill BlockNote's
  // native block drag. Draw.io embeds from the tree use a path bridge + native drop.
  // Capture+stopPropagation keeps ProseMirror's drop pipeline out (it breaks atom
  // diagram selection); clear the drop-cursor via dragleave only.
  const shellRef = useRef<HTMLDivElement>(null);

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
      className={
        showOutline ? "editor-shell editor-shell--with-outline" : "editor-shell"
      }
      onClick={handleLinkClick}
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
        <div className="editor-main">
          <div className="editor-canvas-wrap">
            <PageTags content={content} onChange={onChange} />
            <div className="editor-canvas">
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
    </div>
  );
}
