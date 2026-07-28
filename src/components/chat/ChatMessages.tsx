import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isReasoningUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { useChatStore } from "../../store/chatStore";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatReasoning } from "./ChatReasoning";
import { ChatToolCall } from "./ChatToolCall";

type Props = {
  messages: UIMessage[];
  streaming: boolean;
};

function textFrom(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function assistantHasVisibleContent(message: UIMessage | undefined): boolean {
  if (!message || message.role !== "assistant") return false;
  return (message.parts ?? []).some((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    if (part.type === "reasoning") return part.text.trim().length > 0;
    if (isToolUIPart(part)) return true;
    return false;
  });
}

/** Real user prompts only — skip empty / metadata-only shells. */
function isStickyUserCandidate(message: UIMessage): boolean {
  if (message.role !== "user") return false;
  const meta = (message as UIMessage & {
    metadata?: { kind?: string };
  }).metadata;
  if (meta?.kind === "question-answer") return false;
  return textFrom(message).trim().length > 0;
}

function lastStickyUserIndex(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isStickyUserCandidate(messages[i]!)) return i;
  }
  return -1;
}

function isErrorText(text: string): boolean {
  return text.startsWith("Error:");
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}`;
  return `${s}s`;
}

function WaitingIndicator() {
  const startedAt = useChatStore((s) => s.streamStartedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;

  return (
    <div className="chat-waiting" aria-live="polite">
      <span className="chat-waiting-pulse" aria-hidden="true" />
      <span className="chat-waiting-label">Waiting for response…</span>
      <span className="chat-waiting-timer">{formatElapsed(elapsed)}</span>
    </div>
  );
}

export function ChatMessages({ messages, streaming }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const pinnedUserIdRef = useRef<string | null>(null);
  const followBottomRef = useRef(true);

  const stickyIdx = lastStickyUserIndex(messages);
  const stickyId = stickyIdx >= 0 ? messages[stickyIdx]!.id : null;
  const last = messages[messages.length - 1];
  const showWaiting =
    streaming &&
    (!last ||
      last.role === "user" ||
      (last.role === "assistant" && !assistantHasVisibleContent(last)));

  useLayoutEffect(() => {
    if (!stickyId || stickyId === pinnedUserIdRef.current) return;
    pinnedUserIdRef.current = stickyId;
    followBottomRef.current = true;
    const scroller = scrollerRef.current;
    const sticky = stickyRef.current;
    if (!scroller || !sticky) return;
    const sRect = scroller.getBoundingClientRect();
    const tRect = sticky.getBoundingClientRect();
    scroller.scrollTop += tRect.top - sRect.top;
  }, [stickyId]);

  useEffect(() => {
    if (!followBottomRef.current) return;
    if (stickyId && stickyId !== pinnedUserIdRef.current) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const sticky = stickyRef.current;
    if (sticky) {
      const roomBelow =
        scroller.scrollHeight -
        (sticky.offsetTop + sticky.offsetHeight) -
        scroller.clientHeight;
      if (roomBelow <= 0) return;
    }
    scroller.scrollTop = scroller.scrollHeight;
  }, [messages, streaming, showWaiting, stickyId]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const gap =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      followBottomRef.current = gap < 80;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  if (!messages.length && !streaming) {
    return (
      <div className="chat-messages chat-messages-empty">
        <p>Ask about your vault…</p>
      </div>
    );
  }

  return (
    <div className="chat-messages" ref={scrollerRef}>
      {messages.map((message, index) => {
        if (message.role === "user") {
          const sticky = index === stickyIdx;
          return (
            <div
              key={message.id}
              ref={sticky ? stickyRef : undefined}
              className={
                sticky
                  ? "chat-msg chat-msg-user is-sticky"
                  : "chat-msg chat-msg-user"
              }
            >
              <div className="chat-bubble">{textFrom(message)}</div>
            </div>
          );
        }
        if (message.role !== "assistant") return null;

        if (
          streaming &&
          message.id === last?.id &&
          !assistantHasVisibleContent(message)
        ) {
          return null;
        }

        const msgParts = message.parts ?? [];
        const hasAnswerText = msgParts.some(
          (p) => p.type === "text" && p.text.trim().length > 0,
        );

        return (
          <div key={message.id} className="chat-msg chat-msg-assistant">
            {msgParts.map((part, i) => {
              if (isReasoningUIPart(part)) {
                const laterHasAnswer = msgParts
                  .slice(i + 1)
                  .some(
                    (p) =>
                      (p.type === "text" && p.text.trim()) || isToolUIPart(p),
                  );
                return (
                  <ChatReasoning
                    key={`${message.id}-r-${i}`}
                    part={part}
                    defaultOpen={
                      part.state === "streaming" ||
                      !(hasAnswerText || laterHasAnswer)
                    }
                  />
                );
              }
              if (part.type === "text") {
                if (!part.text) return null;
                if (isErrorText(part.text)) {
                  return (
                    <div
                      key={`${message.id}-t-${i}`}
                      className="chat-error-inthread"
                      role="alert"
                    >
                      {part.text}
                    </div>
                  );
                }
                return (
                  <ChatMarkdown
                    key={`${message.id}-t-${i}`}
                    className="chat-assistant-text"
                    text={part.text}
                    caret={
                      streaming &&
                      message.id === last?.id &&
                      i === msgParts.length - 1
                    }
                  />
                );
              }
              if (isToolUIPart(part)) {
                return (
                  <ChatToolCall key={`${message.id}-tool-${i}`} part={part} />
                );
              }
              return null;
            })}
          </div>
        );
      })}
      {showWaiting && (
        <div className="chat-msg chat-msg-assistant">
          <WaitingIndicator />
        </div>
      )}
    </div>
  );
}
