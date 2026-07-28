import { useEffect, useState } from "react";
import { isReasoningUIPart, type UIMessage } from "ai";
import { ChatMarkdown } from "./ChatMarkdown";

type ReasoningPart = Extract<
  UIMessage["parts"][number],
  { type: "reasoning" }
>;

type Props = {
  part: ReasoningPart;
  /** Collapse when the assistant has moved on to the answer (Cursor-like). */
  defaultOpen?: boolean;
};

export function ChatReasoning({ part, defaultOpen }: Props) {
  const streaming = part.state === "streaming";
  const [open, setOpen] = useState(defaultOpen ?? streaming);

  useEffect(() => {
    if (streaming) {
      setOpen(true);
      return;
    }
    if (defaultOpen === false) setOpen(false);
  }, [streaming, defaultOpen]);

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
          {part.text.trim() ? (
            <ChatMarkdown className="chat-reasoning-md" text={part.text} />
          ) : (
            <span className="chat-reasoning-placeholder">
              {streaming ? "…" : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
