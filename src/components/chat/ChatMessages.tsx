import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
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
  modelRouteViaLabel,
  planModelRoute,
} from "../../ai/languageModel";
import {
  commentChipLabel,
  parseUserTextSegments,
  selectionChipLabel,
} from "../../lib/chatSelectionChips";
import { chipLabelForPath } from "../../lib/chatComposerDom";
import { commentQuoteLabel } from "../../lib/commentAnchors";
import { chatMarkdownToPasteHtml } from "../../lib/chatCopyHtml";
import { writeClipboardHtml, writeClipboardText } from "../../lib/clipboardText";
import { displayAgentStepLimitNotice, isAgentStepLimitNotice } from "../../ai/runChat";
import { resolveModelId } from "../../ai/resolveModelId";
import {
  saveAssistantMessageAsNote,
  suggestedNoteNameFromMarkdown,
} from "../../lib/saveChatMessage";
import type { AiSettings } from "../../ai/types";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { isChatBusy, useChatStore } from "../../store/chatStore";
import { useVaultStore } from "../../store/vaultStore";
import { vaultChatModelId } from "../../store/vaultAiSettingsStore";
import { PromptDialog } from "../AppDialog";
import { EditContextMenu } from "../EditContextMenu";
import { ChatAskUser } from "./ChatAskUser";
import { ChatPickVaultFolder } from "./ChatPickVaultFolder";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatReasoning } from "./ChatReasoning";
import { ChatToolCall } from "./ChatToolCall";
import { ChatSpecialistCard } from "./ChatSpecialistCard";
import { ChatTerminalCall } from "./ChatTerminalCall";

type CopyMenuState = { x: number; y: number; text: string };

type SavePromptState = {
  messageId: string;
  content: string;
  defaultName: string;
};

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

function isErrorText(text: string): boolean {
  return text.startsWith("Error:");
}

/**
 * Virtuoso's scroller ignores CSS padding for item layout — first row sits flush
 * and content can run under the native scrollbar. Put insets on Header/Footer/List
 * instead (and use item padding, not margin — Virtuoso ResizeObserver rule).
 */
const ChatVirtuosoList = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function ChatVirtuosoList({ className, style, ...props }, ref) {
  return (
    <div
      {...props}
      ref={ref}
      style={style}
      className={["chat-messages-list", className].filter(Boolean).join(" ")}
    />
  );
});

const ChatVirtuosoItem = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function ChatVirtuosoItem({ className, style, ...props }, ref) {
  return (
    <div
      {...props}
      ref={ref}
      style={style}
      className={["chat-messages-item", className].filter(Boolean).join(" ")}
    />
  );
});

function ChatVirtuosoHeader() {
  return <div className="chat-messages-pad-top" aria-hidden />;
}

function textFrom(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function saveTextFrom(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text.trim())
    .filter(
      (text) =>
        text.length > 0 &&
        !isErrorText(text) &&
        !isAgentStepLimitNotice(text),
    )
    .join("\n\n");
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
    const id = resolveModelId(settings.baseUrl, modelId || vaultChatModelId());
    const plan = planModelRoute(id, credentialsFromSettings(settings));
    return {
      model: plan.catalogModelId,
      via: modelRouteViaLabel(plan, settings.baseUrl),
    };
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
      ? `Requesting ${target.model} · ${target.via}…`
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
              data-vault-path={segment.path}
              title={segment.path}
            >
              {chipLabelForPath(segment.path)}
            </span>
          );
        }
        if (segment.kind === "skill") {
          return (
            <span
              key={i}
              className="chat-path-chip chat-skill-chip"
              data-skill-id={segment.id}
              title={`/${segment.id}`}
            >
              /{segment.id}
            </span>
          );
        }
        if (segment.kind === "tool") {
          return (
            <span
              key={i}
              className="chat-path-chip chat-tool-chip"
              data-tool-id={segment.id}
              title={`@${segment.id}`}
            >
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
  onRetry: (messageId: string) => void;
  canRetry: boolean;
};

const UserMessageRow = memo(function UserMessageRow({
  message,
  sticky,
  stickyRef,
  onOpenCopyMenu,
  onRetry,
  canRetry,
}: UserRowProps) {
  const files = filePartsFrom(message);
  const text = displayTextFromUserMessage(message);
  const attachedDocNames = attachedDocNamesFromUserMessage(message);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [clampable, setClampable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const showRetry =
    canRetry &&
    isStickyUserCandidate(message) &&
    (text.trim().length > 0 ||
      files.length > 0 ||
      attachedDocNames.length > 0);

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
            className={
              expanded
                ? "chat-bubble"
                : clampable
                  ? "chat-bubble is-clamped is-faded"
                  : "chat-bubble is-clamped"
            }
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
      {showRetry ? (
        <div className="chat-msg-actions">
          <button
            type="button"
            className="chat-msg-action-btn"
            title="Retry"
            aria-label="Retry"
            onClick={(e) => {
              e.stopPropagation();
              onRetry(message.id);
            }}
          >
            <RetryIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
});

function SaveNoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3.5 2h7.44L14 5.06V12.5A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2zm1 1.5v2.75h5V3.5h-5zM4.25 11a.75.75 0 000 1.5h7.5a.75.75 0 000-1.5h-7.5z"
      />
    </svg>
  );
}

function SavedNoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.5 11.2L3.3 8l1.06-1.06L6.5 9.08l5.14-5.14L12.7 5 6.5 11.2z"
      />
    </svg>
  );
}

function CopyMarkdownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5.5 2A1.5 1.5 0 004 3.5V4h-.5A1.5 1.5 0 002 5.5v7A1.5 1.5 0 003.5 14h6a1.5 1.5 0 001.5-1.5V12h.5A1.5 1.5 0 0013 10.5v-7A1.5 1.5 0 0011.5 2h-6zM5 3.5a.5.5 0 01.5-.5h6a.5.5 0 01.5.5v7a.5.5 0 01-.5.5H11V5.5A1.5 1.5 0 009.5 4H5v-.5zM3.5 5H9.5a.5.5 0 01.5.5v7a.5.5 0 01-.5.5h-6a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5z"
      />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8a5 5 0 0 1 8.9-2.1M13 4v2.5H10.5"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 8a5 5 0 0 1-8.9 2.1M3 12v-2.5H5.5"
      />
    </svg>
  );
}

type AssistantRowProps = {
  message: UIMessage;
  streaming: boolean;
  isLast: boolean;
  saved: boolean;
  copied: boolean;
  onOpenCopyMenu: (e: ReactMouseEvent, fullText: string) => void;
  onSave: (messageId: string, content: string) => void;
  onCopyMarkdown: (messageId: string, content: string) => void;
};

const AssistantMessageRow = memo(function AssistantMessageRow({
  message,
  streaming,
  isLast,
  saved,
  copied,
  onOpenCopyMenu,
  onSave,
  onCopyMarkdown,
}: AssistantRowProps) {
  const send = useChatStore((s) => s.send);
  const chatStatus = useChatStore((s) => s.status);
  const msgParts = message.parts ?? [];
  const hasAnswerText = msgParts.some(
    (p) => p.type === "text" && p.text.trim().length > 0,
  );
  const streamingThis = streaming && isLast;
  const copyText = textFrom(message);
  const saveText = saveTextFrom(message);
  const showActions = !streamingThis && saveText.length > 0;
  const canContinueStepLimit =
    isLast && !streamingThis && !isChatBusy(chatStatus);

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
                <span>{displayAgentStepLimitNotice(part.text)}</span>
                {canContinueStepLimit ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="chat-step-limit-continue"
                      onClick={() => {
                        void send("Continue");
                      }}
                    >
                      Continue
                    </button>
                  </>
                ) : null}
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
          if (toolName === "pick_vault_folder") {
            return (
              <ChatPickVaultFolder
                key={`${message.id}-tool-${i}`}
                part={part}
              />
            );
          }
          if (toolName === "ask_user") {
            return (
              <ChatAskUser key={`${message.id}-tool-${i}`} part={part} />
            );
          }
          if (toolName === "run_specialist") {
            return (
              <ChatSpecialistCard
                key={`${message.id}-tool-${i}`}
                part={part}
              />
            );
          }
          if (toolName === "run_terminal") {
            return (
              <ChatTerminalCall
                key={`${message.id}-tool-${i}`}
                part={part}
              />
            );
          }
          return (
            <ChatToolCall key={`${message.id}-tool-${i}`} part={part} />
          );
        }
        return null;
      })}
      {showActions ? (
        <div className="chat-msg-actions">
          <button
            type="button"
            className={
              copied ? "chat-msg-action-btn is-copied" : "chat-msg-action-btn"
            }
            title={copied ? "Copied" : "Copy"}
            aria-label={copied ? "Copied" : "Copy"}
            onClick={(e) => {
              e.stopPropagation();
              onCopyMarkdown(message.id, saveText);
            }}
          >
            {copied ? <SavedNoteIcon /> : <CopyMarkdownIcon />}
          </button>
          <button
            type="button"
            className={
              saved ? "chat-msg-action-btn is-saved" : "chat-msg-action-btn"
            }
            title={saved ? "Saved" : "Save as note"}
            aria-label={saved ? "Saved" : "Save as note"}
            onClick={(e) => {
              e.stopPropagation();
              onSave(message.id, saveText);
            }}
          >
            {saved ? <SavedNoteIcon /> : <SaveNoteIcon />}
          </button>
        </div>
      ) : null}
    </div>
  );
});

const EMPTY_STICKY_REF: React.RefObject<HTMLDivElement | null> = {
  current: null,
};

export function ChatMessages({ messages, streaming, compacting }: Props) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const pinnedUserIdRef = useRef<string | null>(null);
  const followBottomRef = useRef(true);
  const [showStickyOverlay, setShowStickyOverlay] = useState(false);
  const [copyMenu, setCopyMenu] = useState<CopyMenuState | null>(null);
  const [savePrompt, setSavePrompt] = useState<SavePromptState | null>(null);
  const [savedMessageId, setSavedMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const savedClearRef = useRef<number | null>(null);
  const copiedClearRef = useRef<number | null>(null);
  const projectPath = useChatStore((s) => s.projectPath);
  const chatStatus = useChatStore((s) => s.status);
  const retryFromUserMessage = useChatStore((s) => s.retryFromUserMessage);
  const canRetry = !streaming && !isChatBusy(chatStatus);

  useEffect(() => {
    return () => {
      if (savedClearRef.current != null) {
        window.clearTimeout(savedClearRef.current);
      }
      if (copiedClearRef.current != null) {
        window.clearTimeout(copiedClearRef.current);
      }
    };
  }, []);

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

  const requestSave = useCallback((messageId: string, content: string) => {
    setSavePrompt({
      messageId,
      content,
      defaultName: suggestedNoteNameFromMarkdown(content),
    });
  }, []);

  const copyMarkdown = useCallback((messageId: string, content: string) => {
    if (!content.trim()) return;
    void writeClipboardHtml(chatMarkdownToPasteHtml(content), content).then(
      () => {
        if (copiedClearRef.current != null) {
          window.clearTimeout(copiedClearRef.current);
        }
        setCopiedMessageId(messageId);
        copiedClearRef.current = window.setTimeout(() => {
          setCopiedMessageId((id) => (id === messageId ? null : id));
          copiedClearRef.current = null;
        }, 1500);
      },
    );
  }, []);

  const onRetry = useCallback(
    (messageId: string) => {
      void retryFromUserMessage(messageId);
    },
    [retryFromUserMessage],
  );

  const stickyIdx = lastStickyUserIndex(messages);
  const stickyId = stickyIdx >= 0 ? messages[stickyIdx]!.id : null;
  const stickyMessage = stickyIdx >= 0 ? messages[stickyIdx]! : null;
  const last = messages[messages.length - 1];
  const showWaiting =
    !!compacting ||
    (streaming &&
      (!last ||
        last.role === "user" ||
        (last.role === "assistant" && !assistantHasVisibleContent(last))));

  const visibleMessages = useMemo(() => {
    const out: UIMessage[] = [];
    for (const message of messages) {
      if (message.role === "user") {
        out.push(message);
        continue;
      }
      if (message.role !== "assistant") continue;
      if (
        streaming &&
        message.id === last?.id &&
        !assistantHasVisibleContent(message)
      ) {
        continue;
      }
      out.push(message);
    }
    return out;
  }, [messages, streaming, last]);

  const stickyVisibleIdx = useMemo(() => {
    if (!stickyId) return -1;
    return visibleMessages.findIndex((m) => m.id === stickyId);
  }, [visibleMessages, stickyId]);

  useLayoutEffect(() => {
    if (!stickyId || stickyId === pinnedUserIdRef.current) return;
    pinnedUserIdRef.current = stickyId;
    followBottomRef.current = true;
    if (stickyVisibleIdx < 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: stickyVisibleIdx,
      align: "start",
      behavior: "auto",
    });
  }, [stickyId, stickyVisibleIdx]);

  const itemContent = useCallback(
    (_index: number, message: UIMessage) => {
      if (message.role === "user") {
        return (
          <UserMessageRow
            message={message}
            sticky={message.id === stickyId && !showStickyOverlay}
            stickyRef={EMPTY_STICKY_REF}
            onOpenCopyMenu={openCopyMenu}
            onRetry={onRetry}
            canRetry={canRetry}
          />
        );
      }
      return (
        <AssistantMessageRow
          message={message}
          streaming={streaming}
          isLast={message.id === last?.id}
          saved={message.id === savedMessageId}
          copied={message.id === copiedMessageId}
          onOpenCopyMenu={openCopyMenu}
          onSave={requestSave}
          onCopyMarkdown={copyMarkdown}
        />
      );
    },
    [
      stickyId,
      showStickyOverlay,
      openCopyMenu,
      onRetry,
      canRetry,
      streaming,
      last?.id,
      savedMessageId,
      copiedMessageId,
      requestSave,
      copyMarkdown,
    ],
  );

  const virtuosoComponents = useMemo(
    () => ({
      Header: ChatVirtuosoHeader,
      List: ChatVirtuosoList,
      Item: ChatVirtuosoItem,
      Footer: () => (
        <>
          {showWaiting ? (
            <div className="chat-msg chat-msg-assistant">
              <WaitingIndicator compacting={compacting} />
            </div>
          ) : null}
          <div className="chat-messages-pad-bottom" aria-hidden />
        </>
      ),
    }),
    [showWaiting, compacting],
  );

  if (!messages.length && !streaming) {
    return (
      <div className="chat-messages chat-messages-empty">
        <p>Ask about your vault…</p>
      </div>
    );
  }

  return (
    <div className="chat-messages-host">
      {showStickyOverlay && stickyMessage ? (
        <div className="chat-sticky-overlay" aria-hidden>
          <UserMessageRow
            message={stickyMessage}
            sticky
            stickyRef={EMPTY_STICKY_REF}
            onOpenCopyMenu={openCopyMenu}
            onRetry={onRetry}
            canRetry={canRetry}
          />
        </div>
      ) : null}
      <Virtuoso
        ref={virtuosoRef}
        className="chat-messages"
        data={visibleMessages}
        computeItemKey={(_index, message) => message.id}
        increaseViewportBy={{ top: 400, bottom: 600 }}
        atBottomThreshold={80}
        atBottomStateChange={(atBottom) => {
          followBottomRef.current = atBottom;
        }}
        followOutput={() => (followBottomRef.current ? "smooth" : false)}
        rangeChanged={(range) => {
          if (stickyVisibleIdx < 0) {
            setShowStickyOverlay(false);
            return;
          }
          setShowStickyOverlay(range.startIndex > stickyVisibleIdx);
        }}
        itemContent={itemContent}
        components={virtuosoComponents}
      />
      {copyMenu ? (
        <EditContextMenu
          menu={{ x: copyMenu.x, y: copyMenu.y }}
          onClose={() => setCopyMenu(null)}
          onCopy={() => void writeClipboardText(copyMenu.text)}
        />
      ) : null}
      <PromptDialog
        open={savePrompt != null}
        title="Save as note"
        description={
          projectPath
            ? `Create a markdown note in ${projectPath}.`
            : "Create a markdown note in the vault root."
        }
        label="Name"
        defaultValue={savePrompt?.defaultName ?? "Untitled"}
        confirmLabel="Save"
        onCancel={() => setSavePrompt(null)}
        onConfirm={(value) => {
          const payload = savePrompt;
          setSavePrompt(null);
          if (!payload) return;
          void saveAssistantMessageAsNote({
            name: value,
            content: payload.content,
            projectPath,
          })
            .then(() => {
              if (savedClearRef.current != null) {
                window.clearTimeout(savedClearRef.current);
              }
              setSavedMessageId(payload.messageId);
              savedClearRef.current = window.setTimeout(() => {
                setSavedMessageId((id) =>
                  id === payload.messageId ? null : id,
                );
                savedClearRef.current = null;
              }, 2000);
            })
            .catch((e) => {
              useVaultStore.setState({
                error: e instanceof Error ? e.message : String(e),
              });
            });
        }}
      />
    </div>
  );
}
