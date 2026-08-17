import { create } from "zustand";

type DocumentFindStore = {
  open: boolean;
  query: string;
  matchCase: boolean;
  /** 0-based; -1 when there are no matches. */
  activeIndex: number;
  matchCount: number;
  /** Bumped on each open so the input can focus even if already open. */
  focusSeq: number;
  openFind: (query?: string) => void;
  closeFind: () => void;
  setQuery: (query: string) => void;
  setMatchCase: (matchCase: boolean) => void;
  setActiveIndex: (index: number) => void;
  setMatchState: (count: number, index: number) => void;
};

export const useDocumentFindStore = create<DocumentFindStore>((set, get) => ({
  open: false,
  query: "",
  matchCase: false,
  activeIndex: -1,
  matchCount: 0,
  focusSeq: 0,
  openFind: (query) => {
    const prev = get();
    const nextQuery = query !== undefined ? query : prev.query;
    set({
      open: true,
      query: nextQuery,
      focusSeq: prev.focusSeq + 1,
      activeIndex:
        query !== undefined && query !== prev.query ? 0 : prev.activeIndex,
    });
  },
  closeFind: () => {
    if (!get().open) return;
    set({ open: false, matchCount: 0, activeIndex: -1 });
  },
  setQuery: (query) => {
    if (get().query === query) return;
    set({ query, activeIndex: 0 });
  },
  setMatchCase: (matchCase) => {
    if (get().matchCase === matchCase) return;
    set({ matchCase, activeIndex: 0 });
  },
  setActiveIndex: (index) => {
    if (get().activeIndex === index) return;
    set({ activeIndex: index });
  },
  setMatchState: (count, index) => {
    const prev = get();
    if (prev.matchCount === count && prev.activeIndex === index) return;
    set({ matchCount: count, activeIndex: index });
  },
}));
