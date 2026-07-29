import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isFileUIPart,
  isReasoningUIPart,
  isToolUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai";
import {
  attachedDocNamesFromUserMessage,
  displayTextFromUserMessage,
} from "../../ai/chatAttachments";
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

function filePartsFrom(message: UIMessage): FileUIPart[] {
  return (message.parts ?? []).filter(isFileUIPart);
}

function assistantHasVisibleContent(message: UIMessage | undefined): boolean {
  if (!message || message.role !== "assistant") return false;
  return (message.parts ?? []).some((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    // Streaming reasoning may still have empty `text` in messages (preview is separate).
    if (part.type === "reasoning") {
      return (
        part.state === "streaming" || part.text.trim().length > 0
      );
    }
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
  return (
    textFrom(message).trim().length > 0 || filePartsFrom(message).length > 0
  );
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

type UserRowProps = {
  message: UIMessage;
  sticky: boolean;
  stickyRef: React.RefObject<HTMLDivElement | null>;
};

const UserMessageRow = memo(function UserMessageRow({
  message,
  sticky,
  stickyRef,
}: UserRowProps) {
  const files = filePartsFrom(message);
  const text = displayTextFromUserMessage(message);
  const attachedDocNames = attachedDocNamesFromUserMessage(message);

  return (
    <div
      ref={sticky ? stickyRef : undefined}
      className={
        sticky ? "chat-msg chat-msg-user is-sticky" : "chat-msg chat-msg-user"
      }
    >
      {(files.length > 0 || attachedDocNames.length > 0) && (
        <div className="chat-msg-attachments">
          {files.map((file, i) => (
            <div key={`${message.id}-f-${i}`} className="chat-msg-attach">
              {file.mediaType.startsWith("image/") ? (
                <img
                  className="chat-msg-attach-img"
                  src={file.url}
                  alt={file.filename ?? "attachment"}
                />
              ) : (
                <span className="chat-msg-attach-file" title={file.filename ?? "file"}>
                  <span className="chat-msg-attach-kind">File</span>
                  <span className="chat-msg-attach-name">
                    {file.filename ?? "file"}
                  </span>
                </span>
              )}
            </div>
          ))}
          {attachedDocNames.map((name) => (
            <div key={`${message.id}-d-${name}`} className="chat-msg-attach">
              <span className="chat-msg-attach-file" title={name}>
                <span className="chat-msg-attach-kind">File</span>
                <span className="chat-msg-attach-name">{name}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {text ? <div className="chat-bubble">{text}</div> : null}
    </div>
  );
});

type AssistantRowProps = {
  message: UIMessage;
  streaming: boolean;
  isLast: boolean;
};

const AssistantMessageRow = memo(function AssistantMessageRow({
  message,
  streaming,
  isLast,
}: AssistantRowProps) {
  const msgParts = message.parts ?? [];
  const hasAnswerText = msgParts.some(
    (p) => p.type === "text" && p.text.trim().length > 0,
  );
  const streamingThis = streaming && isLast;

  return (
    <div className="chat-msg chat-msg-assistant">
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
              streaming={streamingThis && i === msgParts.length - 1}
              caret={streamingThis && i === msgParts.length - 1}
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
});

export function ChatMessages({ messages, streaming }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const pinnedUserIdRef = useRef<string | null>(null);
  const followBottomRef = useRef(true);
  const scrollRafRef = useRef(0);

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
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const scroller = scrollerRef.current;
      if (!scroller || !followBottomRef.current) return;
      const sticky = stickyRef.current;
      if (sticky) {
        const roomBelow =
          scroller.scrollHeight -
          (sticky.offsetTop + sticky.offsetHeight) -
          scroller.clientHeight;
        if (roomBelow <= 0) return;
      }
      scroller.scrollTop = scroller.scrollHeight;
    });
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
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
          return (
            <UserMessageRow
              key={message.id}
              message={message}
              sticky={index === stickyIdx}
              stickyRef={stickyRef}
            />
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

        return (
          <AssistantMessageRow
            key={message.id}
            message={message}
            streaming={streaming}
            isLast={message.id === last?.id}
          />
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
