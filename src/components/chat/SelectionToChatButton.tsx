import { useEffect, useState } from "react";
import { useChatStore } from "../../store/chatStore";
import { useChatUiStore } from "../../store/chatUiStore";
import { useFocusUiStore } from "../../store/focusUiStore";
import { useVaultStore } from "../../store/vaultStore";

const BUTTON_OFFSET_PX = 6;
const BUTTON_WIDTH_PX = 108;
const BUTTON_HEIGHT_PX = 26;

type Anchor = {
  text: string;
  sourcePath: string | null;
  left: number;
  top: number;
};

/** Which pane a selection lives in, or null when it cannot be quoted. */
function sourcePathFor(node: Node | null): { sourcePath: string | null } | null {
  const el =
    node instanceof Element ? node : (node?.parentElement ?? null);
  if (!el) return null;
  if (el.closest(".chat-composer")) return null;
  if (el.closest(".chat-messages")) return { sourcePath: null };
  if (el.closest(".bn-container, .cm-editor, .pdf-viewer")) {
    return { sourcePath: useVaultStore.getState().activePath };
  }
  return null;
}

function anchorFromSelection(): Anchor | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const text = selection.toString();
  if (!text.trim()) return null;

  const source = sourcePathFor(selection.anchorNode);
  if (!source) return null;

  const rects = selection.getRangeAt(0).getClientRects();
  const rect = rects[rects.length - 1] ?? null;
  if (!rect) return null;

  return {
    text,
    sourcePath: source.sourcePath,
    left: Math.min(
      Math.max(8, rect.right - BUTTON_WIDTH_PX),
      window.innerWidth - BUTTON_WIDTH_PX - 8,
    ),
    top: Math.min(
      rect.bottom + BUTTON_OFFSET_PX,
      window.innerHeight - BUTTON_HEIGHT_PX - 8,
    ),
  };
}

/**
 * Floating "Add to chat" affordance shown next to a text selection in the
 * note editor (Live or Source), PDF viewer, and chat messages.
 */
export function SelectionToChatButton() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const focusActive = useFocusUiStore((s) => s.active);
  const addSelectionToDraft = useChatStore((s) => s.addSelectionToDraft);
  const setChatOpen = useChatUiStore((s) => s.setOpen);

  useEffect(() => {
    if (focusActive) {
      setAnchor(null);
      return;
    }

    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setAnchor(anchorFromSelection()));
    };
    const hide = () => setAnchor(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    document.addEventListener("selectionchange", sync);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", sync);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [focusActive]);

  if (!anchor) return null;

  return (
    <button
      type="button"
      className="selection-to-chat-btn"
      style={{ left: anchor.left, top: anchor.top }}
      title="Add selection to chat"
      // Keep the selection alive so the editor caret does not jump away.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        addSelectionToDraft(anchor.text, anchor.sourcePath);
        setChatOpen(true);
        setAnchor(null);
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 1.5a6.5 6.5 0 0 0-5.7 9.6L1.5 14.5l3.5-.8A6.5 6.5 0 1 0 8 1.5zm0 1.5a5 5 0 1 1-2.6 9.3l-.3-.2-1.7.4.4-1.6-.2-.3A5 5 0 0 1 8 3z"
        />
      </svg>
      Add to chat
    </button>
  );
}
