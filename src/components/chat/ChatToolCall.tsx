import { useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";

type Props = {
  part: UIMessage["parts"][number];
};

export function ChatToolCall({ part }: Props) {
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

  const input =
    "input" in part && part.input !== undefined
      ? JSON.stringify(part.input, null, 2)
      : "";
  const output =
    "output" in part && part.output !== undefined
      ? JSON.stringify(part.output, null, 2)
      : "errorText" in part && part.errorText
        ? String(part.errorText)
        : "";

  return (
    <div className={`chat-tool-call ${err ? "is-error" : ""}`}>
      <button
        type="button"
        className="chat-tool-call-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="chat-tool-call-name">{toolName}</span>
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
