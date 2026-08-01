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
import {
  credentialsFromSettings,
  planModelRoute,
} from "../../ai/languageModel";
import {
  parseUserTextSegments,
  selectionChipLabel,
} from "../../lib/chatSelectionChips";
import { findModel, OPENROUTER_MODELS } from "../../ai/models";
import { resolveModelId } from "../../ai/resolveModelId";
import type { AiSettings } from "../../ai/types";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useChatStore } from "../../store/chatStore";
import { ChatAskUser } from "./ChatAskUser";
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

function streamTargetLabel(
  modelId: string,
  settings: AiSettings,
): { model: string; via: string } | null {
  try {
    const id = resolveModelId(settings.baseUrl, modelId || settings.modelId);
    const plan = planModelRoute(id, credentialsFromSettings(settings));
    const model =
      findModel(OPENROUTER_MODELS, plan.catalogModelId)?.label ??
      plan.catalogModelId;
    const via = plan.transport === "openrouter" ? "OpenRouter" : "Direct";
    return { model, via };
  } catch {
    return null;
  }
}

function WaitingIndicator() {
  const startedAt = useChatStore((s) => s.streamStartedAt);
  const modelId = useChatStore((s) => s.modelId);
  const settings = useAiSettingsStore((s) => s.settings);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;
  const target = streamTargetLabel(modelId, settings);
  const label = target
    ? `Requesting ${target.model} (${target.via})…`
    : "Requesting…";

  return (
    <div className="chat-waiting" aria-live="polite" aria-busy="true">
      <span className="chat-waiting-spinner" aria-hidden="true" />
      <span className="chat-waiting-label">{label}</span>
      <span className="chat-waiting-timer">{formatElapsed(elapsed)}</span>
    </div>
  );
}

/** Sent user text with selection quotes folded back into chips. */
function UserText({ text }: { text: string }) {
  const segments = parseUserTextSegments(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === "text" ? (
          <span key={i}>{segment.text}</span>
        ) : (
          <span
            key={i}
            className="chat-selection-chip"
            title={
              segment.sourcePath
                ? `${segment.sourcePath}\n\n${segment.text}`
                : segment.text
            }
          >
            {selectionChipLabel(segment.text)}
          </span>
        ),
      )}
    </>
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
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [clampable, setClampable] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el || expanded) return;
    const measure = () => setClampable(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  const toggleExpanded = () => setExpanded((v) => !v);

  // Click toggles, unless the user is selecting text inside the bubble.
  const onBubbleClick = () => {
    if (!clampable) return;
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) return;
    toggleExpanded();
  };

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
      {text ? (
        <div className="chat-bubble-wrap">
          <div
            ref={bubbleRef}
            className={expanded ? "chat-bubble" : "chat-bubble is-clamped"}
            onClick={onBubbleClick}
          >
            <UserText text={text} />
          </div>
          {clampable ? (
            <button
              type="button"
              className="chat-bubble-toggle"
              onClick={toggleExpanded}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}
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
          const toolName =
            "toolName" in part && typeof part.toolName === "string"
              ? part.toolName
              : part.type.startsWith("tool-")
                ? part.type.slice("tool-".length)
                : part.type;
          if (toolName === "ask_user") {
            return (
              <ChatAskUser key={`${message.id}-tool-${i}`} part={part} />
            );
          }
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
  const ignoreScrollRef = useRef(false);

  const stickyIdx = lastStickyUserIndex(messages);
  const stickyId = stickyIdx >= 0 ? messages[stickyIdx]!.id : null;
  const last = messages[messages.length - 1];
  const showWaiting =
    streaming &&
    (!last ||
      last.role === "user" ||
      (last.role === "assistant" && !assistantHasVisibleContent(last)));

  const scrollToBottom = () => {
    const scroller = scrollerRef.current;
    if (!scroller || !followBottomRef.current) return;
    ignoreScrollRef.current = true;
    scroller.scrollTop = scroller.scrollHeight;
    requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  };

  useLayoutEffect(() => {
    if (!stickyId || stickyId === pinnedUserIdRef.current) return;
    pinnedUserIdRef.current = stickyId;
    followBottomRef.current = true;
    const scroller = scrollerRef.current;
    const sticky = stickyRef.current;
    if (!scroller || !sticky) return;
    ignoreScrollRef.current = true;
    const sRect = scroller.getBoundingClientRect();
    const tRect = sticky.getBoundingClientRect();
    scroller.scrollTop += tRect.top - sRect.top;
    requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  }, [stickyId]);

  useLayoutEffect(() => {
    if (!followBottomRef.current) return;
    if (stickyId && stickyId !== pinnedUserIdRef.current) return;
    scrollToBottom();
  }, [messages, streaming, showWaiting, stickyId]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => {
      if (ignoreScrollRef.current) return;
      const gap =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      followBottomRef.current = gap < 80;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    // Follow layout growth (streamed text, tools, markdown) even when the
    // messages reference has not changed yet this frame.
    const ro = new ResizeObserver(() => {
      if (followBottomRef.current) scrollToBottom();
    });
    const observeChildren = () => {
      ro.disconnect();
      for (const child of scroller.children) ro.observe(child);
    };
    observeChildren();
    const mo = new MutationObserver(observeChildren);
    mo.observe(scroller, { childList: true });

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
    };
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
