import { memo, useMemo, useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";

type Props = {
  part: UIMessage["parts"][number];
};

const DISPLAY_CAP = 4_000;
/** Keep the collapsed summary cheap even for huge tool inputs. */
const ARGS_SUMMARY_CAP = 240;

function formatToolPayload(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") {
    return value.length > DISPLAY_CAP
      ? `${value.slice(0, DISPLAY_CAP)}\n…truncated (${value.length.toLocaleString()} chars)`
      : value;
  }
  try {
    const raw = JSON.stringify(value, null, 2);
    if (raw.length <= DISPLAY_CAP) return raw;
    return `${raw.slice(0, DISPLAY_CAP)}\n…truncated (${raw.length.toLocaleString()} chars)`;
  } catch {
    return String(value);
  }
}

function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/** One-line, comma-separated tool args for the collapsed header. */
function formatToolArgsSummary(input: unknown): string {
  if (input === undefined || input === null) return "";
  let summary: string;
  if (typeof input === "object" && !Array.isArray(input)) {
    const parts: string[] = [];
    for (const value of Object.values(input as Record<string, unknown>)) {
      const s = formatArgValue(value);
      if (s) parts.push(s);
    }
    summary = parts.join(", ");
  } else {
    summary = formatArgValue(input);
  }
  if (summary.length <= ARGS_SUMMARY_CAP) return summary;
  return `${summary.slice(0, ARGS_SUMMARY_CAP)}…`;
}

function ChatToolCallInner({ part }: Props) {
  const [open, setOpen] = useState(false);
  if (!isToolUIPart(part)) return null;

  const toolName =
    "toolName" in part && typeof part.toolName === "string"
      ? part.toolName
      : part.type.startsWith("tool-")
        ? part.type.slice("tool-".length)
        : part.type;

  const state = "state" in part ? String(part.state) : "unknown";
  const running =
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested" ||
    state === "approval-responded";
  const done = state === "output-available" || state === "output-error";
  const err = state === "output-error";

  const argsSummary = useMemo(() => {
    if (!("input" in part) || part.input === undefined) return "";
    return formatToolArgsSummary(part.input);
  }, [part]);

  // Only serialize when expanded — pretty-printing 80KB+ payloads every render freezes UI.
  const input = useMemo(() => {
    if (!open) return "";
    if (!("input" in part) || part.input === undefined) return "";
    return formatToolPayload(part.input);
  }, [open, part]);

  const output = useMemo(() => {
    if (!open) return "";
    if ("output" in part && part.output !== undefined) {
      return formatToolPayload(part.output);
    }
    if ("errorText" in part && part.errorText) return String(part.errorText);
    return "";
  }, [open, part]);

  return (
    <div className={`chat-tool-call ${err ? "is-error" : ""}`}>
      <button
        type="button"
        className="chat-tool-call-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="chat-tool-call-title">
          <span className="chat-tool-call-name">{toolName}</span>
          {argsSummary ? (
            <span className="chat-tool-call-args" title={argsSummary}>
              {argsSummary}
            </span>
          ) : null}
        </span>
        <span className="chat-tool-call-state">
          {running ? "running" : done ? (err ? "error" : "done") : state}
        </span>
      </button>
      {open && (
        <div className="chat-tool-call-body">
          {input && (
            <>
              <div className="chat-tool-call-label">Input</div>
              <pre>{input}</pre>
            </>
          )}
          {output && (
            <>
              <div className="chat-tool-call-label">Result</div>
              <pre>{output}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const ChatToolCall = memo(ChatToolCallInner);
