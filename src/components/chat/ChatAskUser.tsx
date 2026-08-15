import { memo, useEffect, useMemo, useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import {
  parseAskUserInput,
  parseAskUserOutput,
  resolveAskUserAnswer,
  type AskUserAnswerItem,
  type AskUserQuestion,
} from "../../ai/askUser";

type Props = {
  part: UIMessage["parts"][number];
};

function toolNameOf(part: UIMessage["parts"][number]): string {
  if ("toolName" in part && typeof part.toolName === "string") return part.toolName;
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  return part.type;
}

function toolCallIdOf(part: UIMessage["parts"][number]): string | null {
  if ("toolCallId" in part && typeof part.toolCallId === "string") {
    return part.toolCallId;
  }
  return null;
}

function answerSummary(
  question: AskUserQuestion,
  answer: AskUserAnswerItem | undefined,
): string {
  if (!answer) return "—";
  const labels = answer.selectedOptionIds
    .map((id) => question.options.find((o) => o.id === id)?.label ?? id)
    .filter(Boolean);
  const bits = [...labels];
  if (answer.customText) bits.push(answer.customText);
  return bits.length ? bits.join(", ") : "—";
}

function emptyDraft(questions: AskUserQuestion[]): AskUserAnswerItem[] {
  return questions.map((q) => ({
    questionId: q.id,
    selectedOptionIds: [],
    customText: "",
  }));
}

function QuestionForm({
  question,
  value,
  onChange,
  disabled,
}: {
  question: AskUserQuestion;
  value: AskUserAnswerItem;
  onChange: (next: AskUserAnswerItem) => void;
  disabled: boolean;
}) {
  const multi = Boolean(question.allow_multiple);
  const allowCustom = question.allow_custom !== false;

  const toggle = (optionId: string) => {
    if (disabled) return;
    if (multi) {
      const set = new Set(value.selectedOptionIds);
      if (set.has(optionId)) set.delete(optionId);
      else set.add(optionId);
      onChange({ ...value, selectedOptionIds: [...set] });
      return;
    }
    onChange({ ...value, selectedOptionIds: [optionId] });
  };

  return (
    <fieldset className="chat-ask-user-q" disabled={disabled}>
      <legend className="chat-ask-user-prompt">{question.prompt}</legend>
      <div className="chat-ask-user-options" role={multi ? "group" : "radiogroup"}>
        {question.options.map((opt) => {
          const selected = value.selectedOptionIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              className={`chat-ask-user-option${selected ? " is-selected" : ""}${multi ? " is-multi" : ""}`}
              aria-pressed={selected}
              onClick={() => toggle(opt.id)}
            >
              <span className="chat-ask-user-option-mark" aria-hidden="true" />
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
      {allowCustom && (
        <label className="chat-ask-user-custom">
          <span className="chat-ask-user-custom-label">Or type your own</span>
          <input
            type="text"
            className="chat-ask-user-custom-input"
            value={value.customText ?? ""}
            placeholder="Custom answer…"
            onChange={(e) =>
              onChange({
                ...value,
                customText: e.target.value,
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget
                  .closest("form, .chat-ask-user")
                  ?.querySelector<HTMLButtonElement>(".chat-ask-user-submit")
                  ?.click();
              }
            }}
          />
        </label>
      )}
    </fieldset>
  );
}

function ChatAskUserInner({ part }: Props) {
  const isAsk =
    isToolUIPart(part) && toolNameOf(part) === "ask_user";
  const state = isAsk && "state" in part ? String(part.state) : "unknown";
  const toolCallId = isAsk ? toolCallIdOf(part) : null;
  const input = isAsk
    ? parseAskUserInput("input" in part ? part.input : undefined)
    : null;
  const output = isAsk
    ? parseAskUserOutput("output" in part ? part.output : undefined)
    : null;
  const err =
    isAsk && state === "output-error" && "errorText" in part
      ? String(part.errorText ?? "Error")
      : null;

  const awaiting =
    state === "input-available" ||
    state === "input-streaming" ||
    state === "approval-requested";

  const draftKey = input
    ? `${toolCallId ?? ""}:${input.questions.map((q) => q.id).join(",")}`
    : "";

  const [draft, setDraft] = useState<AskUserAnswerItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!input) return;
    setDraft(emptyDraft(input.questions));
    setSubmitting(false);
    // Reset only when call/questions identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const canSubmit = useMemo(() => {
    if (!toolCallId || !input || submitting) return false;
    return draft.every((a, i) => {
      const q = input.questions[i];
      if (!q) return false;
      const hasOpt = a.selectedOptionIds.length > 0;
      const hasCustom = Boolean(a.customText?.trim());
      const allowCustom = q.allow_custom !== false;
      return hasOpt || (allowCustom && hasCustom);
    });
  }, [toolCallId, input, submitting, draft]);

  const submit = () => {
    if (!toolCallId || !canSubmit) return;
    setSubmitting(true);
    const answers = draft.map((a) => ({
      questionId: a.questionId,
      selectedOptionIds: a.selectedOptionIds,
      customText: a.customText?.trim() || undefined,
    }));
    const ok = resolveAskUserAnswer(toolCallId, { answers });
    if (!ok) setSubmitting(false);
  };

  if (!isAsk) return null;

  if (!input && awaiting) {
    return (
      <div className="chat-ask-user is-loading">
        <div className="chat-ask-user-title">Waiting for question…</div>
      </div>
    );
  }

  if (!input) {
    return (
      <div className={`chat-ask-user${err ? " is-error" : ""}`}>
        <div className="chat-ask-user-title">ask_user</div>
        {err ? <div className="chat-ask-user-error">{err}</div> : null}
      </div>
    );
  }

  if (awaiting) {
    return (
      <div className="chat-ask-user is-awaiting">
        {input.title ? (
          <div className="chat-ask-user-title">{input.title}</div>
        ) : (
          <div className="chat-ask-user-title">Question</div>
        )}
        {input.questions.map((q, i) => (
          <QuestionForm
            key={q.id}
            question={q}
            value={
              draft[i] ?? {
                questionId: q.id,
                selectedOptionIds: [],
                customText: "",
              }
            }
            disabled={submitting}
            onChange={(next) => {
              setDraft((prev) => {
                const copy = [...prev];
                copy[i] = next;
                return copy;
              });
            }}
          />
        ))}
        <div className="chat-ask-user-actions">
          <button
            type="button"
            className="chat-ask-user-submit"
            disabled={!canSubmit}
            onClick={submit}
          >
            {submitting ? "Sending…" : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`chat-ask-user is-done${err ? " is-error" : ""}`}>
      <div className="chat-ask-user-title">Answer</div>
      {err ? (
        <div className="chat-ask-user-error">{err}</div>
      ) : (
        <ul className="chat-ask-user-summary">
          {input.questions.map((q) => {
            const ans = output?.answers.find((a) => a.questionId === q.id);
            return (
              <li key={q.id}>
                <span className="chat-ask-user-summary-q" title={q.prompt}>
                  {q.prompt}
                </span>
                <span className="chat-ask-user-summary-a">
                  {answerSummary(q, ans)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const ChatAskUser = memo(ChatAskUserInner);
