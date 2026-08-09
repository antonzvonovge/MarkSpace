import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  isFileUIPart,
  isReasoningUIPart,
  isToolUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai";
import { FcComments } from "react-icons/fc";
import {
  attachedDocNamesFromUserMessage,
  displayTextFromUserMessage,
} from "../../ai/chatAttachments";
import {
  credentialsFromSettings,
  planModelRoute,
} from "../../ai/languageModel";
import {
  commentChipLabel,
  parseUserTextSegments,
  selectionChipLabel,
} from "../../lib/chatSelectionChips";
import { chipLabelForPath } from "../../lib/chatComposerDom";
import { commentQuoteLabel } from "../../lib/commentAnchors";
import { writeClipboardText } from "../../lib/clipboardText";
import { findModel, OPENROUTER_MODELS } from "../../ai/models";
import { isAgentStepLimitNotice } from "../../ai/runChat";
import { resolveModelId } from "../../ai/resolveModelId";
import type { AiSettings } from "../../ai/types";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useChatStore } from "../../store/chatStore";
import { EditContextMenu } from "../EditContextMenu";
import { ChatAskUser } from "./ChatAskUser";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatReasoning } from "./ChatReasoning";
import { ChatToolCall } from "./ChatToolCall";

type CopyMenuState = { x: number; y: number; text: string };

/** Selected text if the selection is inside `el`, otherwise "". */
function selectionTextIn(el: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return "";
  return sel.toString();
}

type Props = {
  messages: UIMessage[];
  streaming: boolean;
  /** True while older turns are being summarized before the new reply. */
  compacting?: boolean;
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

function WaitingIndicator({ compacting }: { compacting?: boolean }) {
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
  const label = compacting
    ? "Compacting older messages…"
    : target
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

/** Sent user text with selection quotes and path markers folded back into chips. */
function UserText({ text }: { text: string }) {
  const segments = parseUserTextSegments(text);
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === "text") {
          return <span key={i}>{segment.text}</span>;
        }
        if (segment.kind === "path") {
          return (
            <span
              key={i}
              className={
                segment.path.endsWith("/")
                  ? "chat-path-chip is-dir"
                  : "chat-path-chip"
              }
              title={segment.path}
            >
              {chipLabelForPath(segment.path)}
            </span>
          );
        }
        if (segment.kind === "skill") {
          return (
            <span key={i} className="chat-path-chip chat-skill-chip" title={`/${segment.id}`}>
              /{segment.id}
            </span>
          );
        }
        if (segment.kind === "tool") {
          return (
            <span key={i} className="chat-path-chip chat-tool-chip" title={`@${segment.id}`}>
              @{segment.id}
            </span>
          );
        }
        if (segment.kind === "comment") {
          return (
            <CommentChip
              key={i}
              quote={segment.quote}
              body={segment.text}
              sourcePath={segment.sourcePath}
            />
          );
        }
        return (
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
        );
      })}
    </>
  );
}

function CommentChip({
  quote,
  body,
  sourcePath,
}: {
  quote: string;
  body: string;
  sourcePath: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const quoteLabel = commentQuoteLabel(quote);
  const label = commentChipLabel({ text: body, quote });
  const pathLabel = sourcePath ? chipLabelForPath(sourcePath) : null;

  return (
    <span
      className={
        expanded
          ? "chat-comment-chip-card is-expanded"
          : "chat-comment-chip-card"
      }
    >
      <button
        type="button"
        className="chat-comment-chip"
        title={
          expanded
            ? "Collapse comment"
            : [sourcePath, quoteLabel && `“${quoteLabel}”`, body]
                .filter(Boolean)
                .join("\n\n")
        }
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        <span className="chat-comment-chip-mark" aria-hidden>
          <FcComments size={12} />
        </span>
        <span className="chat-comment-chip-label">{label}</span>
        {pathLabel ? (
          <span className="chat-comment-chip-path">{pathLabel}</span>
        ) : null}
        <span className="chat-comment-chip-chevron" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <span className="chat-comment-chip-body">
          {sourcePath ? (
            <span className="chat-comment-chip-meta" title={sourcePath}>
              {sourcePath}
            </span>
          ) : null}
          {quoteLabel ? (
            <blockquote className="chat-comment-chip-quote">
              {quoteLabel}
            </blockquote>
          ) : null}
          {body.trim() ? (
            <span className="chat-comment-chip-text">{body}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

type UserRowProps = {
  message: UIMessage;
  sticky: boolean;
  stickyRef: React.RefObject<HTMLDivElement | null>;
  onOpenCopyMenu: (e: ReactMouseEvent, fullText: string) => void;
};

const UserMessageRow = memo(function UserMessageRow({
  message,
  sticky,
  stickyRef,
  onOpenCopyMenu,
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
      onContextMenu={(e) => onOpenCopyMenu(e, text)}
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
  onOpenCopyMenu: (e: ReactMouseEvent, fullText: string) => void;
};

const AssistantMessageRow = memo(function AssistantMessageRow({
  message,
  streaming,
  isLast,
  onOpenCopyMenu,
}: AssistantRowProps) {
  const msgParts = message.parts ?? [];
  const hasAnswerText = msgParts.some(
    (p) => p.type === "text" && p.text.trim().length > 0,
  );
  const streamingThis = streaming && isLast;
  const copyText = textFrom(message);

  return (
    <div
      className="chat-msg chat-msg-assistant"
      onContextMenu={(e) => onOpenCopyMenu(e, copyText)}
    >
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
          if (isAgentStepLimitNotice(part.text)) {
            return (
              <div
                key={`${message.id}-t-${i}`}
                className="chat-step-limit-notice"
                role="status"
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

export function ChatMessages({ messages, streaming, compacting }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const pinnedUserIdRef = useRef<string | null>(null);
  const followBottomRef = useRef(true);
  const ignoreScrollRef = useRef(false);
  const [copyMenu, setCopyMenu] = useState<CopyMenuState | null>(null);

  const openCopyMenu = useCallback(
    (e: ReactMouseEvent, fullText: string) => {
      e.preventDefault();
      e.stopPropagation();
      const selected = selectionTextIn(e.currentTarget as HTMLElement);
      const text = selected || fullText;
      if (!text.trim()) return;
      setCopyMenu({ x: e.clientX, y: e.clientY, text });
    },
    [],
  );

  const stickyIdx = lastStickyUserIndex(messages);
  const stickyId = stickyIdx >= 0 ? messages[stickyIdx]!.id : null;
  const last = messages[messages.length - 1];
  const showWaiting =
    !!compacting ||
    (streaming &&
      (!last ||
        last.role === "user" ||
        (last.role === "assistant" && !assistantHasVisibleContent(last))));

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
              onOpenCopyMenu={openCopyMenu}
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
            onOpenCopyMenu={openCopyMenu}
          />
        );
      })}
      {showWaiting && (
        <div className="chat-msg chat-msg-assistant">
          <WaitingIndicator compacting={compacting} />
        </div>
      )}
      {copyMenu ? (
        <EditContextMenu
          menu={{ x: copyMenu.x, y: copyMenu.y }}
          onClose={() => setCopyMenu(null)}
          onCopy={() => void writeClipboardText(copyMenu.text)}
        />
      ) : null}
    </div>
  );
}
