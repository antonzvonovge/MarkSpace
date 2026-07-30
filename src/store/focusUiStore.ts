import { create } from "zustand";
import { useChatUiStore } from "./chatUiStore";
import { useSidebarUiStore } from "./sidebarUiStore";

type FocusUiStore = {
  /** Both side panels collapsed; chrome toggles for them are locked. */
  active: boolean;
  restoreSidebar: boolean;
  restoreChat: boolean;
  toggle: () => void;
};

export const useFocusUiStore = create<FocusUiStore>((set, get) => ({
  active: false,
  restoreSidebar: true,
  restoreChat: false,
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
