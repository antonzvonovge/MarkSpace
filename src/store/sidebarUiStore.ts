import { create } from "zustand";
import { loadShellLayout } from "../lib/shellLayout";
import {
  TAG_FILES_COLUMN_WIDTH,
  clampTagFilesWidth,
} from "../components/sidebar/tagFileSlot";

const OPEN_KEY = "markspace-sidebar-open";
const CALENDAR_OPEN_KEY = "markspace-sidebar-calendar-open";
const SIDEBAR_PANE_KEY = "markspace-sidebar-pane";
/** Previous folders/tags toggle. Read once to migrate, then left unused. */
const WORKSPACE_VIEW_KEY = "markspace-workspace-view";
const TAG_EXPANDED_KEY = "markspace-tag-expanded";
const TAG_HIDE_KEY = "markspace-tag-hide-subtags";
const TAG_SELECTION_KEY = "markspace-tag-selection";
const TAG_FILES_WIDTH_KEY = "markspace-tag-files-width";

export type SidebarPane =
  | "files"
  | "tags"
  | "tasks"
  | "routines"
  | "comments"
  | "dashboards";

const SIDEBAR_PANES: readonly SidebarPane[] = [
  "files",
  "tags",
  "tasks",
  "routines",
  "comments",
  "dashboards",
];

function readOpen(): boolean {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    // Default open when unset (file tree should be visible on first launch).
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // ignore
  }
}

function readCalendarOpen(): boolean {
  try {
    return localStorage.getItem(CALENDAR_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCalendarOpen(open: boolean) {
  try {
    localStorage.setItem(CALENDAR_OPEN_KEY, open ? "1" : "0");
  } catch {
    // ignore
  }
}

function isSidebarPane(value: string | null): value is SidebarPane {
  return value != null && (SIDEBAR_PANES as readonly string[]).includes(value);
}

function readSidebarPane(): SidebarPane {
  try {
    const stored = localStorage.getItem(SIDEBAR_PANE_KEY);
    if (isSidebarPane(stored)) return stored;
    if (localStorage.getItem(WORKSPACE_VIEW_KEY) === "tags") return "tags";
    return "files";
  } catch {
    return "files";
  }
}

function writeSidebarPane(pane: SidebarPane) {
  try {
    localStorage.setItem(SIDEBAR_PANE_KEY, pane);
  } catch {
    // ignore
  }
}

function readTagExpanded(): string[] {
  try {
    const raw = localStorage.getItem(TAG_EXPANDED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function writeTagExpanded(paths: string[]) {
  try {
    localStorage.setItem(TAG_EXPANDED_KEY, JSON.stringify(paths));
  } catch {
    // ignore
  }
}

function readHideSubtagNotes(): boolean {
  try {
    return localStorage.getItem(TAG_HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function readTagSelection(): string | null {
  try {
    const raw = localStorage.getItem(TAG_SELECTION_KEY);
    return raw;
  } catch {
    return null;
  }
}

function readTagFilesWidth(): number {
  try {
    const raw = localStorage.getItem(TAG_FILES_WIDTH_KEY);
    if (raw == null) return TAG_FILES_COLUMN_WIDTH;
    const width = Number(raw);
    if (!Number.isFinite(width)) return TAG_FILES_COLUMN_WIDTH;
    return clampTagFilesWidth(width);
  } catch {
    return TAG_FILES_COLUMN_WIDTH;
  }
}

function writeTagFilesWidth(width: number) {
  try {
    localStorage.setItem(TAG_FILES_WIDTH_KEY, String(clampTagFilesWidth(width)));
  } catch {
    // ignore
  }
}

function writeTagSelection(path: string | null) {
  try {
    if (path == null) localStorage.removeItem(TAG_SELECTION_KEY);
    else localStorage.setItem(TAG_SELECTION_KEY, path);
  } catch {
    // ignore
  }
}

type SidebarUiStore = {
  open: boolean;
  calendarOpen: boolean;
  lastSizePercent: number;
  treeRevealRequest: { path: string; id: number } | null;
  sidebarPane: SidebarPane;
  /** Lowercased tag paths that are expanded. */
  tagExpandedPaths: string[];
  /** `null` = no note list, `""` = Untagged, otherwise a tag path. */
  selectedTagPath: string | null;
  hideSubtagNotes: boolean;
  /** Pixel width of the tag file column. */
  tagFilesWidth: number;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setCalendarOpen: (open: boolean) => void;
  toggleCalendar: () => void;
  rememberSizePercent: (percent: number) => void;
  revealPathInTree: (path: string) => void;
  setSidebarPane: (pane: SidebarPane) => void;
  toggleTagExpanded: (path: string) => void;
  collapseTagTree: () => void;
  expandTagPaths: (paths: string[]) => void;
  setTagExpandedPaths: (paths: string[]) => void;
  setSelectedTagPath: (path: string | null) => void;
  setHideSubtagNotes: (hide: boolean) => void;
  setTagFilesWidth: (width: number) => void;
};

export const useSidebarUiStore = create<SidebarUiStore>((set) => ({
  open: typeof window !== "undefined" ? readOpen() : true,
  calendarOpen: typeof window !== "undefined" ? readCalendarOpen() : false,
  lastSizePercent:
    typeof window !== "undefined" ? loadShellLayout().sidebar : 22,
  treeRevealRequest: null,
  sidebarPane: typeof window !== "undefined" ? readSidebarPane() : "files",
  tagExpandedPaths: typeof window !== "undefined" ? readTagExpanded() : [],
  selectedTagPath: typeof window !== "undefined" ? readTagSelection() : null,
  hideSubtagNotes: typeof window !== "undefined" ? readHideSubtagNotes() : false,
  tagFilesWidth:
    typeof window !== "undefined" ? readTagFilesWidth() : TAG_FILES_COLUMN_WIDTH,
  setOpen: (open) => {
    writeOpen(open);
    set({ open });
  },
  toggle: () => {
    set((s) => {
      const open = !s.open;
      writeOpen(open);
      return { open };
    });
  },
  setCalendarOpen: (open) => {
    writeCalendarOpen(open);
    set({ calendarOpen: open });
  },
  toggleCalendar: () => {
    set((s) => {
      const calendarOpen = !s.calendarOpen;
      writeCalendarOpen(calendarOpen);
      return { calendarOpen };
    });
  },
  rememberSizePercent: (percent) => {
    if (!Number.isFinite(percent) || percent < 10 || percent > 70) return;
    set({ lastSizePercent: percent });
  },
  revealPathInTree: (path) => {
    if (!path) return;
    writeOpen(true);
    writeSidebarPane("files");
    set((state) => ({
      open: true,
      sidebarPane: "files",
      treeRevealRequest: {
        path,
        id: (state.treeRevealRequest?.id ?? 0) + 1,
      },
    }));
  },
  setSidebarPane: (pane) => {
    writeSidebarPane(pane);
    set({ sidebarPane: pane });
  },
  toggleTagExpanded: (path) => {
    const key = path.toLowerCase();
    set((state) => {
      const has = state.tagExpandedPaths.includes(key);
      const tagExpandedPaths = has
        ? state.tagExpandedPaths.filter((item) => item !== key)
        : [...state.tagExpandedPaths, key];
      writeTagExpanded(tagExpandedPaths);
      return { tagExpandedPaths };
    });
  },
  collapseTagTree: () => {
    writeTagExpanded([]);
    set({ tagExpandedPaths: [] });
  },
  expandTagPaths: (paths) => {
    set((state) => {
      const next = new Set(state.tagExpandedPaths);
      for (const path of paths) next.add(path.toLowerCase());
      const tagExpandedPaths = [...next];
      writeTagExpanded(tagExpandedPaths);
      return { tagExpandedPaths };
    });
  },
  setTagExpandedPaths: (paths) => {
    const tagExpandedPaths = [
      ...new Set(paths.map((path) => path.toLowerCase()).filter(Boolean)),
    ];
    writeTagExpanded(tagExpandedPaths);
    set({ tagExpandedPaths });
  },
  setSelectedTagPath: (path) => {
    writeTagSelection(path);
    set({ selectedTagPath: path });
  },
  setHideSubtagNotes: (hide) => {
    try {
      localStorage.setItem(TAG_HIDE_KEY, hide ? "1" : "0");
    } catch {
      // ignore
    }
    set({ hideSubtagNotes: hide });
  },
  setTagFilesWidth: (width) => {
    const tagFilesWidth = clampTagFilesWidth(width);
    set((state) => {
      if (state.tagFilesWidth === tagFilesWidth) return state;
      writeTagFilesWidth(tagFilesWidth);
      return { tagFilesWidth };
    });
  },
}));
