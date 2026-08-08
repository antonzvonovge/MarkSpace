import { create } from "zustand";
import { useChatUiStore } from "./chatUiStore";
import { useSidebarUiStore } from "./sidebarUiStore";

type FocusUiStore = {
  /** Both side panels collapsed for an expanded editor. */
  active: boolean;
  restoreSidebar: boolean;
  restoreChat: boolean;
  toggle: () => void;
  /** Leave focus mode without restoring the saved panel layout. */
  deactivate: () => void;
};

export const useFocusUiStore = create<FocusUiStore>((set, get) => ({
  active: false,
  restoreSidebar: true,
  restoreChat: false,
  deactivate: () => {
    if (!get().active) return;
    set({ active: false });
  },
  toggle: () => {
    const { active, restoreSidebar, restoreChat } = get();
    if (active) {
      useSidebarUiStore.getState().setOpen(restoreSidebar);
      useChatUiStore.getState().setOpen(restoreChat);
      set({ active: false });
      return;
    }
    const sidebar = useSidebarUiStore.getState().open;
    const chat = useChatUiStore.getState().open;
    useSidebarUiStore.getState().setOpen(false);
    useChatUiStore.getState().setOpen(false);
    set({
      active: true,
      restoreSidebar: sidebar,
      restoreChat: chat,
    });
  },
}));
