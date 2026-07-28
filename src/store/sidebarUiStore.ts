import { create } from "zustand";
import { loadShellLayout } from "../lib/shellLayout";

const OPEN_KEY = "markspace-sidebar-open";

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

type SidebarUiStore = {
  open: boolean;
  lastSizePercent: number;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  rememberSizePercent: (percent: number) => void;
};

export const useSidebarUiStore = create<SidebarUiStore>((set) => ({
  open: typeof window !== "undefined" ? readOpen() : true,
  lastSizePercent:
    typeof window !== "undefined" ? loadShellLayout().sidebar : 22,
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
  rememberSizePercent: (percent) => {
    if (!Number.isFinite(percent) || percent < 10 || percent > 70) return;
    set({ lastSizePercent: percent });
  },
}));
