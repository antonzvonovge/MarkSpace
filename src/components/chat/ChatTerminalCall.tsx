import { memo, useMemo, useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import { useToolRunTimer } from "./useToolRunTimer";

type Props = {
  part: UIMessage["parts"][number];
};

const OUTPUT_CAP = 8_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatOutput(text: string): string {
  if (text.length <= OUTPUT_CAP) return text;
  return `${text.slice(0, OUTPUT_CAP)}\n…truncated (${text.length.toLocaleString()} chars)`;
}

function ChatTerminalCallInner({ part }: Props) {
  const [open, setOpen] = useState(false);
  if (!isToolUIPart(part)) return null;

  const state = "state" in part ? String(part.state) : "unknown";
  const running =
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested" ||
    state === "approval-responded";
  const elapsed = useToolRunTimer(running);
  const err = state === "output-error";
  const input = asRecord("input" in part ? part.input : undefined);
  const output = asRecord("output" in part ? part.output : undefined);
  const command = str(input?.command);
  const cwd = str(input?.cwd);
  const stdout = str(output?.stdout);
  const stderr = str(output?.stderr);
  const exitCode =
    typeof output?.exit_code === "number" ? output.exit_code : null;
  const denied = str(output?.error) === "Denied by user";
  const errorText =
    err && "errorText" in part && part.errorText
      ? String(part.errorText)
      : str(output?.error);

  const status = useMemo(() => {
    if (denied) return "denied";
    if (err) return "error";
    if (running) return "running";
    if (output?.timed_out) return "timed out";
    if (output?.killed) return "stopped";
    if (typeof exitCode === "number") return `exit ${exitCode}`;
    return state === "output-available" ? "done" : state;
  }, [denied, err, running, output, exitCode, state]);

  return (
    <div className={`chat-terminal-call${err || denied ? " is-error" : ""}`}>
      <button
        type="button"
        className="chat-terminal-call-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="chat-terminal-call-title">
          <span className="chat-terminal-call-name">run_terminal</span>
          {command ? (
            <span className="chat-terminal-call-cmd" title={command}>
              {command}
            </span>
          ) : null}
        </span>
        <span className="chat-terminal-call-state">
          {status}
          {elapsed ? (
            <span className="chat-tool-call-timer">{elapsed}</span>
          ) : null}
        </span>
      </button>
      {open && (
        <div className="chat-terminal-call-body">
          {cwd ? (
            <>
              <div className="chat-terminal-call-label">cwd</div>
              <pre>{cwd}</pre>
            </>
          ) : null}
          {command ? (
            <>
              <div className="chat-terminal-call-label">Command</div>
              <pre>{command}</pre>
            </>
          ) : null}
          {stdout ? (
            <>
              <div className="chat-terminal-call-label">stdout</div>
              <pre>{formatOutput(stdout)}</pre>
            </>
          ) : null}
          {stderr ? (
            <>
              <div className="chat-terminal-call-label">stderr</div>
              <pre>{formatOutput(stderr)}</pre>
            </>
          ) : null}
          {errorText ? (
            <>
              <div className="chat-terminal-call-label">Error</div>
              <pre>{errorText}</pre>
            </>
          ) : null}
          {!command && !stdout && !stderr && !errorText ? (
            <div className="chat-terminal-call-empty">No output yet</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export const ChatTerminalCall = memo(ChatTerminalCallInner);
