import { create } from "zustand";
import {
  parseDashboard,
  pickDashboardColor,
  serializeDashboard,
} from "../lib/dashboardFormat";
import { readNote, writeNote } from "../lib/vaultApi";
import { useVaultStore } from "./vaultStore";

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

/** Read the stored color. If the file has none and is not open, assign one once. */
export async function loadDashboardColor(path: string): Promise<void> {
  if (!path || useDashboardColorStore.getState().byPath[path] || inflight.has(path)) {
    return;
  }
  inflight.add(path);
  try {
    const open = useVaultStore.getState().tabs.some((tab) => tab.path === path);
    const tabBody = useVaultStore.getState().tabs.find((tab) => tab.path === path)?.body;
    const raw = tabBody ?? (await readNote(path));
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
