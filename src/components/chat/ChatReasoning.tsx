import { memo, useEffect, useRef, useState } from "react";
import { isReasoningUIPart, type UIMessage } from "ai";
import { useChatStore } from "../../store/chatStore";

type ReasoningPart = Extract<
  UIMessage["parts"][number],
  { type: "reasoning" }
>;

type Props = {
  part: ReasoningPart;
  /** Collapse when the assistant has moved on to the answer (Cursor-like). */
  defaultOpen?: boolean;
};

/** Keep DOM text cheap while thinking — show only the recent tail. */
const STREAM_TAIL = 2200;

function formatStreamTail(text: string): string {
  if (text.length <= STREAM_TAIL) return text;
  return `…${text.slice(-STREAM_TAIL)}`;
}

function ChatReasoningInner({ part, defaultOpen }: Props) {
  const streaming = part.state === "streaming";
  const [open, setOpen] = useState(defaultOpen ?? streaming);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streaming) {
      setOpen(true);
      return;
    }
    if (defaultOpen === false) setOpen(false);
  }, [streaming, defaultOpen]);

  // Patch DOM directly from the light preview store — no React re-render storm,
  // and `messages` is not rewritten on every reasoning token.
  useEffect(() => {
    if (!streaming || !open) return;
    const el = bodyRef.current;
    if (!el) return;

    const paint = (text: string | null) => {
      el.textContent = formatStreamTail(text ?? "");
    };

    paint(useChatStore.getState().streamReasoningText);
    return useChatStore.subscribe((state, prev) => {
      if (state.streamReasoningText === prev.streamReasoningText) return;
      paint(state.streamReasoningText);
    });
  }, [streaming, open]);

  if (!isReasoningUIPart(part)) return null;
  if (!part.text.trim() && !streaming) return null;

  return (
    <div className={`chat-reasoning ${streaming ? "is-streaming" : ""}`}>
      <button
        type="button"
        className="chat-reasoning-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="chat-reasoning-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="chat-reasoning-label">
          {streaming ? "Thinking…" : "Thought"}
        </span>
      </button>
      {open && (
        <div className="chat-reasoning-body">
          {streaming ? (
            <div
              ref={bodyRef}
              className="chat-md chat-reasoning-md chat-md-plain is-streaming-plain"
            />
          ) : part.text.trim() ? (
            // Plain text only — full remark parse of long thoughts freezes the UI.
            <div className="chat-md chat-reasoning-md chat-md-plain">
              {part.text}
            </div>
          ) : (
            <span className="chat-reasoning-placeholder" />
          )}
        </div>
      )}
    </div>
  );
}

export const ChatReasoning = memo(ChatReasoningInner);
