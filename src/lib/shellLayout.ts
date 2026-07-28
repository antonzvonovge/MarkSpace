export type ShellLayout = {
  /** Sidebar width as % of the group (roughly 10–40). */
  sidebar: number;
  /** Expanded chat width as % (never 0 — hide is separate). */
  chat: number;
};

const STORAGE_KEY = "markspace-shell-layout-v4";

export const DEFAULT_SHELL_LAYOUT: ShellLayout = {
  sidebar: 22,
  chat: 28,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function loadShellLayout(): ShellLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHELL_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<ShellLayout>;
    const sidebar =
      typeof parsed.sidebar === "number" && Number.isFinite(parsed.sidebar)
        ? clamp(parsed.sidebar, 10, 45)
        : DEFAULT_SHELL_LAYOUT.sidebar;
    const chat =
      typeof parsed.chat === "number" && Number.isFinite(parsed.chat)
        ? clamp(parsed.chat, 15, 55)
        : DEFAULT_SHELL_LAYOUT.chat;
    return { sidebar, chat };
  } catch {
    return { ...DEFAULT_SHELL_LAYOUT };
  }
}

export function saveShellLayout(layout: ShellLayout): void {
  const next: ShellLayout = {
    sidebar: clamp(layout.sidebar, 10, 45),
    chat: clamp(layout.chat, 15, 55),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/** Build a 3-panel percentage layout that sums to 100. */
export function toGroupLayout(
  saved: ShellLayout,
  chatOpen: boolean,
): { sidebar: number; main: number; chat: number } {
  const sidebar = clamp(saved.sidebar, 10, 45);
  const chat = chatOpen ? clamp(saved.chat, 15, 55) : 0;
  const main = Math.max(20, 100 - sidebar - chat);
  const sum = sidebar + main + chat;
  return {
    sidebar: (sidebar / sum) * 100,
    main: (main / sum) * 100,
    chat: (chat / sum) * 100,
  };
}
