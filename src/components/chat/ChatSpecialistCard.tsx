import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import {
  getSpecialistLive,
  subscribeSpecialistLive,
  type SpecialistStep,
} from "../../ai/specialists";
import {
  isSpecialistKind,
  specialistLabel,
  type SpecialistKind,
} from "../../ai/toolPacks";

type Props = {
  part: UIMessage["parts"][number];
};

const SUMMARY_CAP = 160;
const STEP_CAP = 2_000;

function formatPayload(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") {
    return value.length <= STEP_CAP
      ? value
      : `${value.slice(0, STEP_CAP)}…`;
  }
  try {
    const raw = JSON.stringify(value, null, 2);
    return raw.length <= STEP_CAP ? raw : `${raw.slice(0, STEP_CAP)}…`;
  } catch {
    return String(value);
  }
}

function oneLine(text: string, max = SUMMARY_CAP): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function parseInput(part: UIMessage["parts"][number]): {
  title: string;
  kind: SpecialistKind | null;
  task: string;
} {
  const input =
    "input" in part && part.input && typeof part.input === "object"
      ? (part.input as Record<string, unknown>)
      : {};
  const kindRaw = typeof input.kind === "string" ? input.kind : "";
  const kind = isSpecialistKind(kindRaw) ? kindRaw : null;
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : typeof input.task === "string"
        ? oneLine(input.task, 80) || "Specialist"
        : "Specialist";
  const task = typeof input.task === "string" ? input.task : "";
  return { title, kind, task };
}

function parseOutput(part: UIMessage["parts"][number]): {
  summary: string;
  changedPaths: string[];
  needsClarification?: string;
  steps: SpecialistStep[];
  error?: string;
} | null {
  if (!("output" in part) || part.output == null) return null;
  if (typeof part.output !== "object") {
    return {
      summary: oneLine(String(part.output)),
      changedPaths: [],
      steps: [],
    };
  }
  const o = part.output as Record<string, unknown>;
  const steps = Array.isArray(o.steps)
    ? (o.steps as SpecialistStep[]).filter(
        (s) => s && typeof s.toolName === "string",
      )
    : [];
  return {
    summary:
      typeof o.summary === "string"
        ? o.summary
        : typeof o.error === "string"
          ? o.error
          : "",
    changedPaths: Array.isArray(o.changedPaths)
      ? o.changedPaths.filter((p): p is string => typeof p === "string")
      : [],
    needsClarification:
      typeof o.needsClarification === "string"
        ? o.needsClarification
        : undefined,
    steps,
    error: typeof o.error === "string" ? o.error : undefined,
  };
}

function toolCallIdOf(part: UIMessage["parts"][number]): string | null {
  if ("toolCallId" in part && typeof part.toolCallId === "string") {
    return part.toolCallId;
  }
  return null;
}

function ChatSpecialistCardInner({ part }: Props) {
  const [open, setOpen] = useState(false);
  if (!isToolUIPart(part)) return null;

  const toolCallId = toolCallIdOf(part);
  const live = useSyncExternalStore(
    subscribeSpecialistLive,
    () => (toolCallId ? getSpecialistLive(toolCallId) : undefined),
    () => undefined,
  );

  const { title, kind, task } = useMemo(() => parseInput(part), [part]);
  const output = useMemo(() => parseOutput(part), [part]);

  const state = "state" in part ? String(part.state) : "unknown";
  const running =
    live?.running === true ||
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested" ||
    state === "approval-responded";
  const err =
    state === "output-error" || Boolean(output?.error);

  const kindLabel = kind
    ? specialistLabel(kind)
    : live?.kind
      ? specialistLabel(live.kind)
      : "Specialist";

  const statusLine = running
    ? live?.status || "Starting…"
    : output?.error
      ? oneLine(output.error)
      : output?.summary
        ? oneLine(output.summary)
        : state === "output-error" && "errorText" in part
          ? oneLine(String(part.errorText ?? "Error"))
          : task
            ? oneLine(task)
            : "Done";

  const steps = live?.steps?.length
    ? live.steps
    : output?.steps?.length
      ? output.steps
      : [];

  return (
    <div
      className={`chat-specialist-card${running ? " is-running" : ""}${err ? " is-error" : ""}`}
    >
      <button
        type="button"
        className="chat-specialist-card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="chat-specialist-card-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 3.5h4.5V8H3V3.5Zm5.5 0H13V6H8.5V3.5ZM3 9h4.5v3.5H3V9Zm5.5 2H13v1.5H8.5V11Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path
              d="M5.25 8v1M10.75 6v5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="chat-specialist-card-main">
          <span className="chat-specialist-card-title-row">
            <span className="chat-specialist-card-title">{title}</span>
            <span className="chat-specialist-card-kind">{kindLabel}</span>
          </span>
          <span className="chat-specialist-card-status" title={statusLine}>
            {statusLine}
          </span>
        </span>
      </button>
      {open && (
        <div className="chat-specialist-card-body">
          {output?.needsClarification ? (
            <div className="chat-specialist-card-note">
              Needs clarification: {output.needsClarification}
            </div>
          ) : null}
          {output?.changedPaths?.length ? (
            <div className="chat-specialist-card-note">
              Changed: {output.changedPaths.join(", ")}
            </div>
          ) : null}
          {steps.length === 0 ? (
            <div className="chat-specialist-card-empty">No tool steps yet</div>
          ) : (
            <ul className="chat-specialist-card-steps">
              {steps.map((step, i) => (
                <li key={`${step.toolName}-${i}`}>
                  <div className="chat-specialist-card-step-name">
                    {step.toolName}
                    {step.error ? (
                      <span className="chat-specialist-card-step-err">
                        {" "}
                        error
                      </span>
                    ) : null}
                  </div>
                  {step.input !== undefined ? (
                    <pre>{formatPayload(step.input)}</pre>
                  ) : null}
                  {step.output !== undefined ? (
                    <pre>{formatPayload(step.output)}</pre>
                  ) : null}
                  {step.error ? <pre>{step.error}</pre> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export const ChatSpecialistCard = memo(ChatSpecialistCardInner);
