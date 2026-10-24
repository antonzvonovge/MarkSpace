import { create } from "zustand";
import {
  parseDashboard,
  pickDashboardColor,
  serializeDashboard,
} from "../lib/dashboardFormat";
import { normalizeProjectColor } from "../lib/projectColors";
import { readNote, writeNote } from "../lib/vaultApi";
import { isFileTab, useVaultStore } from "./vaultStore";

type DashboardColorState = {
  byPath: Record<string, string>;
  note: (path: string, color: string) => void;
  dropMissing: (paths: readonly string[]) => void;
};

export const useDashboardColorStore = create<DashboardColorState>((set) => ({
  byPath: {},
  note: (path, color) =>
    set((state) =>
      state.byPath[path] === color
        ? state
        : { byPath: { ...state.byPath, [path]: color } },
    ),
  dropMissing: (paths) =>
    set((state) => {
      const keep = new Set(paths);
      let changed = false;
      const byPath: Record<string, string> = {};
      for (const [path, color] of Object.entries(state.byPath)) {
        if (keep.has(path)) byPath[path] = color;
        else changed = true;
      }
      return changed ? { byPath } : state;
    }),
}));

const inflight = new Set<string>();

function dashboardSourceText(path: string): string | null {
  const st = useVaultStore.getState();
  if (st.activePath === path) return st.content;
  const tab = st.tabs.find((t) => t.path === path);
  if (tab && isFileTab(tab) && typeof tab.body === "string") return tab.body;
  return null;
}

/** Persist icon color; updates the open tab buffer when the file is open. */
export async function setDashboardColor(
  path: string,
  color: string,
): Promise<void> {
  if (!path) return;
  const hex = normalizeProjectColor(color);
  if (!hex) return;
  const prev = useDashboardColorStore.getState().byPath[path] ?? "";
  useDashboardColorStore.getState().note(path, hex);
  try {
    const openBody = dashboardSourceText(path);
    const raw = openBody ?? (await readNote(path));
    const doc = parseDashboard(raw);
    if (doc.color === hex) return;
    const next = serializeDashboard({ ...doc, color: hex });
    useVaultStore.setState({ suppressWatchUntil: Date.now() + 1500 });
    const saved = await writeNote(path, next);
    const st = useVaultStore.getState();
    const tabs = st.tabs.map((tab) =>
      tab.path === path && isFileTab(tab)
        ? { ...tab, body: saved, dirty: false }
        : tab,
    );
    if (st.activePath === path) {
      useVaultStore.setState({ content: saved, dirty: false, tabs });
    } else {
      useVaultStore.setState({ tabs });
    }
  } catch (err) {
    useDashboardColorStore.getState().note(path, prev);
    useVaultStore.setState({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Read the stored color. If the file has none and is not open, assign one once. */
export async function loadDashboardColor(path: string): Promise<void> {
  if (!path || useDashboardColorStore.getState().byPath[path] || inflight.has(path)) {
    return;
  }
  inflight.add(path);
  try {
    const open = useVaultStore.getState().tabs.some((tab) => tab.path === path);
    const raw = dashboardSourceText(path) ?? (await readNote(path));
    const doc = parseDashboard(raw);
    if (doc.color) {
      useDashboardColorStore.getState().note(path, doc.color);
      return;
    }
    const known = useDashboardColorStore.getState().byPath[path];
    if (known || open) return;
    const color = pickDashboardColor();
    useDashboardColorStore.getState().note(path, color);
    await writeNote(path, serializeDashboard({ ...doc, color }));
  } catch {
    /* unreadable file: leave the icon uncolored */
  } finally {
    inflight.delete(path);
  }
}
