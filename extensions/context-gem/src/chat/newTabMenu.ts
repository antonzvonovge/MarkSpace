import { getChatMenuItems, type ChatMenuAction } from "../lib/chatMenu";
import type { AnalysisMode, FreeChatKind } from "../lib/types";

export type NewTabMenuHandlers = {
  onAnalysis: (mode: AnalysisMode, selection: string) => void;
  onFreeChat: (kind: FreeChatKind) => void;
};

function eventPathIncludes(event: Event, node: Node): boolean {
  return event.composedPath().includes(node);
}

export function setupNewTabMenu(
  anchorBtn: HTMLButtonElement,
  menuEl: HTMLElement,
  getSelectionText: () => string,
  handlers: NewTabMenuHandlers,
): () => void {
  let open = false;
  let capturedSelection = "";

  const positionMenu = (): void => {
    const rect = anchorBtn.getBoundingClientRect();
    menuEl.style.top = `${rect.bottom + 4}px`;
    menuEl.style.left = "auto";
    menuEl.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  };

  const closeMenu = (): void => {
    if (!open) return;
    open = false;
    menuEl.hidden = true;
    anchorBtn.setAttribute("aria-expanded", "false");
  };

  const runAction = (action: ChatMenuAction): void => {
    closeMenu();
    if (action.kind === "free") {
      handlers.onFreeChat(action.freeChatKind);
      return;
    }
    const selection = capturedSelection || getSelectionText();
    handlers.onAnalysis(action.mode, selection);
  };

  const renderMenu = (): void => {
    capturedSelection = getSelectionText();
    menuEl.replaceChildren();

    for (const item of getChatMenuItems()) {
      if (item.type === "separator") {
        const sep = document.createElement("div");
        sep.className = "chat-new-tab-menu-separator";
        sep.setAttribute("role", "separator");
        menuEl.appendChild(sep);
        continue;
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chat-new-tab-menu-item";
      btn.textContent = item.title;
      btn.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        runAction(item.action);
      });
      menuEl.appendChild(btn);
    }
  };

  const openMenu = (): void => {
    renderMenu();
    menuEl.hidden = false;
    positionMenu();
    open = true;
    anchorBtn.setAttribute("aria-expanded", "true");
  };

  const toggleMenu = (): void => {
    if (open) closeMenu();
    else openMenu();
  };

  const onAnchorPointerDown = (event: PointerEvent): void => {
    event.stopPropagation();
    capturedSelection = getSelectionText();
  };

  const onAnchorClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu();
  };

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (
      eventPathIncludes(event, anchorBtn) ||
      eventPathIncludes(event, menuEl)
    ) {
      return;
    }
    closeMenu();
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeMenu();
  };

  const onWindowResize = (): void => {
    if (open) positionMenu();
  };

  anchorBtn.addEventListener("pointerdown", onAnchorPointerDown);
  anchorBtn.addEventListener("click", onAnchorClick);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);
  window.addEventListener("resize", onWindowResize);

  return (): void => {
    closeMenu();
    anchorBtn.removeEventListener("pointerdown", onAnchorPointerDown);
    anchorBtn.removeEventListener("click", onAnchorClick);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
    window.removeEventListener("resize", onWindowResize);
  };
}
