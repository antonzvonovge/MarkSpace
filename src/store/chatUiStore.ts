import { create } from "zustand";
import { loadShellLayout } from "../lib/shellLayout";

const OPEN_KEY = "markspace-chat-open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // ignore
  }
}

type ChatUiStore = {
  open: boolean;
  lastSizePercent: number;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  rememberSizePercent: (percent: number) => void;
};

export const useChatUiStore = create<ChatUiStore>((set) => ({
  open: typeof window !== "undefined" ? readOpen() : false,
  lastSizePercent:
    typeof window !== "undefined" ? loadShellLayout().chat : 28,
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
