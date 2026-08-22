import { memo, useEffect, useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import {
  countWords,
  parseIeltsPaperInput,
  parseIeltsPaperOutput,
  resolveIeltsPaper,
  splitGapPrompt,
  type IeltsPaperQuestion,
} from "../../ai/ieltsPaper";
import { ChatMarkdown } from "./ChatMarkdown";

type Props = {
  part: UIMessage["parts"][number];
};

function toolCallIdOf(part: UIMessage["parts"][number]): string | null {
  if ("toolCallId" in part && typeof part.toolCallId === "string") {
    return part.toolCallId;
  }
  return null;
}

function toolState(part: UIMessage["parts"][number]): string {
  return "state" in part ? String(part.state) : "unknown";
}

function GapRow({
  question,
  value,
  disabled,
  onChange,
}: {
  question: IeltsPaperQuestion;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const parts = splitGapPrompt(question.prompt);
  if (parts.length === 1) {
    return (
      <label className="chat-ielts-paper-row">
        <span className="chat-ielts-paper-n">{question.n}.</span>
        <span className="chat-ielts-paper-stem">
          {question.prompt}{" "}
          <input
            type="text"
            className="chat-ielts-paper-gap"
            value={value}
            disabled={disabled}
            placeholder={question.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </span>
      </label>
    );
  }
  return (
    <div className="chat-ielts-paper-row">
      <span className="chat-ielts-paper-n">{question.n}.</span>
      <span className="chat-ielts-paper-stem">
        {parts.map((chunk, i) => (
          <span key={i}>
            {chunk}
            {i < parts.length - 1 ? (
              <input
                type="text"
                className="chat-ielts-paper-gap"
                value={value}
                disabled={disabled}
                placeholder={question.placeholder}
                onChange={(e) => onChange(e.target.value)}
              />
            ) : null}
          </span>
        ))}
      </span>
    </div>
  );
}

const paperDrafts = new Map<string, Record<string, string>>();

function ChatIeltsPaperInner({ part }: Props) {
  const input = parseIeltsPaperInput("input" in part ? part.input : undefined);
  const output = parseIeltsPaperOutput(
    "output" in part ? part.output : undefined,
  );
  const toolCallId = toolCallIdOf(part);
  const state = toolState(part);
  const err =
    state === "output-error" && "errorText" in part
      ? String(part.errorText ?? "Error")
      : null;
  const awaiting =
    state === "input-available" ||
    state === "input-streaming" ||
    state === "approval-requested";

  const draftKey = input
    ? `${toolCallId ?? ""}:${input.questions.map((q) => q.id).join(",")}`
    : "";
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!input) return;
    const stored = (toolCallId && paperDrafts.get(toolCallId)) || {};
    const next: Record<string, string> = {};
    for (const q of input.questions) next[q.id] = stored[q.id] ?? "";
    if (toolCallId) paperDrafts.set(toolCallId, next);
    setDraft(next);
    setSubmitting(false);
  }, [draftKey]);

  const canSubmit = Boolean(
    toolCallId && input && input.questions.length > 0 && awaiting && !submitting,
  );

  const submit = () => {
    if (!toolCallId || !input || !canSubmit) return;
    setSubmitting(true);
    const ok = resolveIeltsPaper(toolCallId, {
      answers: input.questions.map((q) => ({
        questionId: q.id,
        n: q.n,
        value: (draft[q.id] ?? "").trim(),
      })),
    });
    if (ok) paperDrafts.delete(toolCallId);
    else setSubmitting(false);
  };

  if (!input && awaiting) {
    return (
      <div className="chat-ielts-paper is-loading">
        <div className="chat-ielts-paper-kicker">Preparing paper…</div>
      </div>
    );
  }
  if (!input) return null;

  const readonly = !awaiting || input.questions.length === 0;
  const showBank =
    input.options.length > 0 &&
    input.questions.some((q) => q.kind === "choice");

  return (
    <div
      className={`chat-ielts-paper${readonly ? " is-done" : " is-awaiting"}${err ? " is-error" : ""}`}
    >
      <div className="chat-ielts-paper-kicker">{input.title}</div>
      {input.intro ? (
        <div className="chat-ielts-paper-intro">
          <ChatMarkdown text={input.intro} />
        </div>
      ) : null}
      {showBank ? (
        <div className="chat-ielts-paper-bank">
          <div className="chat-ielts-paper-heading">Options</div>
          <ul>
            {input.options.map((o) => (
              <li key={o.id}>
                <strong>{o.id}</strong> {o.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {input.questions.map((q, i) => {
        const heading =
          q.heading && q.heading !== input.questions[i - 1]?.heading
            ? q.heading
            : null;
        const value = draft[q.id] ?? "";
        const setValue = (next: string) =>
          setDraft((prev) => {
            const merged = { ...prev, [q.id]: next };
            if (toolCallId) paperDrafts.set(toolCallId, merged);
            return merged;
          });
        return (
          <div key={q.id}>
            {heading ? (
              <div className="chat-ielts-paper-heading">{heading}</div>
            ) : null}
            {q.kind === "long" ? (
              <label className="chat-ielts-paper-long">
                <span className="chat-ielts-paper-stem">{q.prompt}</span>
                <textarea
                  className="chat-ielts-paper-textarea"
                  value={readonly ? (output?.answers.find((a) => a.questionId === q.id)?.value ?? value) : value}
                  disabled={readonly || submitting}
                  placeholder={q.placeholder || "Write here…"}
                  rows={10}
                  onChange={(e) => setValue(e.target.value)}
                />
                {!readonly ? (
                  <span className="chat-ielts-paper-words">
                    {countWords(value)} words
                  </span>
                ) : null}
              </label>
            ) : q.kind === "choice" ? (
              <div className="chat-ielts-paper-row is-choice">
                <span className="chat-ielts-paper-n">{q.n}.</span>
                <span className="chat-ielts-paper-stem">{q.prompt}</span>
                <div className="chat-ielts-paper-letters" role="radiogroup">
                  {q.options.map((opt) => {
                    const selected = (readonly
                      ? output?.answers.find((a) => a.questionId === q.id)?.value
                      : value) === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`chat-ielts-paper-letter${selected ? " is-selected" : ""}`}
                        disabled={readonly || submitting}
                        title={opt.label}
                        aria-pressed={selected}
                        onClick={() => setValue(opt.id)}
                      >
                        {opt.id}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : readonly ? (
              <div className="chat-ielts-paper-row">
                <span className="chat-ielts-paper-n">{q.n}.</span>
                <span className="chat-ielts-paper-stem">
                  {q.prompt}{" "}
                  <em>
                    {output?.answers.find((a) => a.questionId === q.id)?.value ||
                      "—"}
                  </em>
                </span>
              </div>
            ) : (
              <GapRow
                question={q}
                value={value}
                disabled={submitting}
                onChange={setValue}
              />
            )}
          </div>
        );
      })}
      {err ? <div className="chat-ielts-paper-error">{err}</div> : null}
      {awaiting && input.questions.length > 0 ? (
        <div className="chat-ielts-paper-actions">
          <button
            type="button"
            className="chat-ielts-paper-submit"
            disabled={!canSubmit}
            onClick={submit}
          >
            {submitting ? "Sending…" : "Submit"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const ChatIeltsPaper = memo(ChatIeltsPaperInner);
