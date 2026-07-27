import "@blocknote/mantine/style.css";

import { BlockNoteView } from "@blocknote/mantine";
import type { Theme } from "@blocknote/mantine";
import {
  SuggestionMenuController,
  useCreateBlockNote,
  useEditorChange,
} from "@blocknote/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { getNoteSlashMenuItems } from "./slashMenuItems";

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

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
};

export function NoteEditor({ path, content, onChange }: Props) {
  const openNote = useVaultStore((s) => s.openNote);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const theme = usePrefsStore((s) => s.prefs.theme);
  const liveFontFamily = usePrefsStore((s) => s.prefs.liveFontFamily);
  const applyingRef = useRef(false);
  const lastPathRef = useRef<string | null>(null);
  const lastExternalRef = useRef(content);
  const notePathRef = useRef(path);
  notePathRef.current = path;
  const editorRef = useRef<ReturnType<typeof useCreateBlockNote> | null>(null);

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

  const editor = useCreateBlockNote(
    {
      schema: noteEditorSchema,
      uploadFile: (file, blockId) => uploadFileRef.current(file, blockId),
      resolveFileUrl: (url) => resolveFileUrlRef.current(url),
      pasteHandler: (ctx) => pasteHandlerRef.current(ctx),
      _tiptapOptions: {
        extensions: [layoutKeymap],
      },
    },
    [path],
  );
  editorRef.current = editor;

  useEditorChange((ed) => {
    if (applyingRef.current) return;
    const md = ed.blocksToMarkdownLossy();
    const wikiMd = markdownToWiki(md);
    lastExternalRef.current = wikiMd;
    onChange(wikiMd);
  }, editor);

  const getSlashMenuItems = useCallback(
    async (query: string) => getNoteSlashMenuItems(editor, query),
    [editor],
  );

  useEffect(() => {
    const pathChanged = lastPathRef.current !== path;
    const externalChange = content !== lastExternalRef.current;
    if (!pathChanged && !externalChange) return;

    applyingRef.current = true;
    const blocks = editor.tryParseMarkdownToBlocks(wikiToMarkdown(content));
    editor.replaceBlocks(editor.document, blocks);
    lastPathRef.current = path;
    lastExternalRef.current = content;
    applyingRef.current = false;
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
        const cleaned = href.replace(/^\.\//, "");
        let resolved = await resolveWikiTarget(cleaned.replace(/\.md$/i, ""));
        if (!resolved && cleaned.endsWith(".md")) {
          resolved = await resolveWikiTarget(cleaned);
        }
        if (resolved) await openNote(resolved);
      })();
    },
    [openNote, refreshTree],
  );

  return (
    <div className="editor-shell" onClick={handleLinkClick}>
      <div className="editor-canvas">
        <BlockNoteView editor={editor} theme={editorTheme} slashMenu={false}>
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={getSlashMenuItems}
            suggestionMenuComponent={NoteSlashSuggestionMenu}
          />
        </BlockNoteView>
      </div>
    </div>
  );
}
