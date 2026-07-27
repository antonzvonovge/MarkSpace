import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SlashCommand } from "./slashCommand";
import {
  isExternalHref,
  isWikiHref,
  markdownToWiki,
  wikiTargetFromHref,
  wikiToMarkdown,
} from "../lib/wikiMarkdown";
import { createNote, resolveWikiTarget } from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
};

export function NoteEditor({ path, content, onChange }: Props) {
  const openNote = useVaultStore((s) => s.openNote);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const applyingRef = useRef(false);
  const lastPathRef = useRef<string | null>(null);
  const lastExternalRef = useRef(content);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          class: "ms-link",
        },
      }),
      Placeholder.configure({
        placeholder: "Type '/' for commands…",
      }),
      Typography,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SlashCommand,
    ],
    content: wikiToMarkdown(content),
    onUpdate: ({ editor: ed }) => {
      if (applyingRef.current) return;
      const storage = ed.storage as { markdown?: { getMarkdown: () => string } };
      const md = storage.markdown?.getMarkdown() ?? "";
      const wikiMd = markdownToWiki(md);
      lastExternalRef.current = wikiMd;
      onChange(wikiMd);
    },
    editorProps: {
      attributes: {
        class: "ms-prose",
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest("a");
        if (!anchor) return false;
        const href = anchor.getAttribute("href");
        if (!href) return false;
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

        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;

    const pathChanged = lastPathRef.current !== path;
    const externalChange = content !== lastExternalRef.current;

    if (!pathChanged && !externalChange) return;

    applyingRef.current = true;
    editor.commands.setContent(wikiToMarkdown(content));
    lastPathRef.current = path;
    lastExternalRef.current = content;
    applyingRef.current = false;
  }, [editor, path, content]);

  if (!editor) return null;

  return (
    <div className="editor-shell">
      <EditorContent editor={editor} />
    </div>
  );
}
