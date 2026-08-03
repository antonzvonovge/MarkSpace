import { create } from "zustand";
import { loadShellLayout } from "../lib/shellLayout";

const OPEN_KEY = "markspace-sidebar-open";
const CALENDAR_OPEN_KEY = "markspace-sidebar-calendar-open";

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

type SidebarUiStore = {
  open: boolean;
  calendarOpen: boolean;
  lastSizePercent: number;
  treeRevealRequest: { path: string; id: number } | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setCalendarOpen: (open: boolean) => void;
  toggleCalendar: () => void;
  rememberSizePercent: (percent: number) => void;
  revealPathInTree: (path: string) => void;
};

export const useSidebarUiStore = create<SidebarUiStore>((set) => ({
  open: typeof window !== "undefined" ? readOpen() : true,
  calendarOpen: typeof window !== "undefined" ? readCalendarOpen() : false,
  lastSizePercent:
    typeof window !== "undefined" ? loadShellLayout().sidebar : 22,
  treeRevealRequest: null,
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
    set((state) => ({
      open: true,
      treeRevealRequest: {
        path,
        id: (state.treeRevealRequest?.id ?? 0) + 1,
      },
    }));
  },
}));
