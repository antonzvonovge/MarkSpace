import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { insertMermaidItem } from "./mermaid/slashItem";
import { insertPlantUmlItem } from "./plantuml/slashItem";
import type { NoteEditorSchema } from "./schema";

type SlashItem = DefaultReactSuggestionItem & { key?: string };

export function getNoteSlashMenuItems(
  editor: BlockNoteEditor<NoteEditorSchema["blockSchema"]>,
  query: string,
): DefaultReactSuggestionItem[] {
  const defaults = (getDefaultReactSlashMenuItems(editor) as SlashItem[]).filter(
    (item) => {
      // Only keep Image from Media — video/audio/file aren't wired for vault uploads.
      if (item.key === "video" || item.key === "audio" || item.key === "file") {
        return false;
      }
      return true;
    },
  );

  const all: DefaultReactSuggestionItem[] = [
    ...defaults,
    insertMermaidItem(editor),
    insertPlantUmlItem(editor),
  ];

  const q = query.trim().toLowerCase();
  if (!q) return all;

  return all.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    const aliases = item.aliases ?? [];
    return aliases.some((alias) => {
      const a = alias.toLowerCase();
      // Generic aliases caused Media spam for short queries like "im".
      if (q.length <= 2 && (a === "media" || a === "url" || a === "upload")) {
        return false;
      }
      return a.includes(q);
    });
  });
}
