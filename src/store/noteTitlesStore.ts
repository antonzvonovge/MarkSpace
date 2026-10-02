import { create } from "zustand";
import { displayNoteTitle, noteTitleIndexKey } from "../lib/noteTitle";
import { listNoteTitles } from "../lib/vaultApi";

export const EMPTY_NOTE_TITLES: Record<string, string> = {};

type NoteTitlesStore = {
  titlesByPath: Record<string, string>;
  refresh: () => Promise<void>;
  patch: (path: string, title: string | null) => void;
  patchFromMarkdown: (path: string, markdown: string) => void;
};

function sameTitles(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export const useNoteTitlesStore = create<NoteTitlesStore>((set, get) => ({
  titlesByPath: EMPTY_NOTE_TITLES,

  refresh: async () => {
    try {
      const rows = await listNoteTitles();
      const next: Record<string, string> = {};
      for (const row of rows) {
        if (row.path && row.title) next[row.path] = row.title;
      }
      if (sameTitles(get().titlesByPath, next)) return;
      set({ titlesByPath: next });
    } catch {
      if (get().titlesByPath !== EMPTY_NOTE_TITLES) {
        set({ titlesByPath: EMPTY_NOTE_TITLES });
      }
    }
  },

  patch: (path, title) => {
    const cur = get().titlesByPath;
    if (!title) {
      if (!(path in cur)) return;
      const next = { ...cur };
      delete next[path];
      set({ titlesByPath: next });
      return;
    }
    if (cur[path] === title) return;
    set({ titlesByPath: { ...cur, [path]: title } });
  },

  patchFromMarkdown: (path, markdown) => {
    const key = noteTitleIndexKey(path);
    if (!key) return;
    get().patch(key, displayNoteTitle(markdown));
  },
}));
