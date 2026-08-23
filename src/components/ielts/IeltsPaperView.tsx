import { useMemo, useState } from "react";
import {
  countWords,
  splitGapPrompt,
  type IeltsPaper,
  type IeltsPaperAnswerItem,
  type IeltsPaperQuestion,
} from "../../ai/ieltsPaper";

type Props = {
  paper: IeltsPaper;
  disabled?: boolean;
  submitting?: boolean;
  onSubmit: (answers: IeltsPaperAnswerItem[]) => void;
};

function GapRow({
  question,
  value,
  disabled,
  invalid,
  onChange,
}: {
  question: IeltsPaperQuestion;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (next: string) => void;
}) {
  const parts = splitGapPrompt(question.prompt);
  const input = (
    <input
      type="text"
      className={`ielts-quiz-gap${invalid ? " is-invalid" : ""}`}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  if (parts.length === 1) {
    return (
      <label className="ielts-quiz-row">
        <span className="ielts-quiz-n">{question.n}</span>
        <span className="ielts-quiz-stem">
          {question.prompt} {input}
        </span>
      </label>
    );
  }
  return (
    <div className="ielts-quiz-row">
      <span className="ielts-quiz-n">{question.n}</span>
      <span className="ielts-quiz-stem">
        {parts.map((chunk, i) => (
          <span key={i}>
            {chunk}
            {i < parts.length - 1 ? input : null}
          </span>
        ))}
      </span>
    </div>
  );
}

function isFilled(question: IeltsPaperQuestion, value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (question.kind === "long") return countWords(v) >= 20;
  return true;
}

export function IeltsPaperView({
  paper,
  disabled,
  submitting,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const q of paper.questions) next[q.id] = "";
    return next;
  });
  const [showErrors, setShowErrors] = useState(false);
  const showBank =
    paper.options.length > 0 &&
    paper.questions.some((q) => q.kind === "choice");
  const locked = Boolean(disabled || submitting);
  const ids = useMemo(
    () => paper.questions.map((q) => q.id).join(","),
    [paper],
  );

  const missing = paper.questions.filter(
    (q) => !isFilled(q, draft[q.id] ?? ""),
  );

  const submit = () => {
    if (missing.length > 0) {
      setShowErrors(true);
      return;
    }
    onSubmit(
      paper.questions.map((q) => ({
        questionId: q.id,
        n: q.n,
        value: (draft[q.id] ?? "").trim(),
      })),
    );
  };

  return (
    <div className={`ielts-quiz-paper${locked ? " is-locked" : ""}`} key={ids}>
      {paper.title ? (
        <p className="dict-practice-prompt ielts-quiz-title">{paper.title}</p>
      ) : null}
      {paper.intro ? (
        <div className="ielts-quiz-passage">{paper.intro}</div>
      ) : null}
      {showBank ? (
        <ul className="ielts-quiz-bank">
          {paper.options.map((o) => (
            <li key={o.id}>
              <strong>{o.id}</strong> {o.label}
            </li>
          ))}
        </ul>
      ) : null}
      {paper.questions.map((q, i) => {
        const heading =
          q.heading && q.heading !== paper.questions[i - 1]?.heading
            ? q.heading
            : null;
        const value = draft[q.id] ?? "";
        const invalid = showErrors && !isFilled(q, value);
        const setValue = (next: string) =>
          setDraft((prev) => ({ ...prev, [q.id]: next }));
        return (
          <div key={q.id}>
            {heading ? (
              <div className="ielts-quiz-heading">{heading}</div>
            ) : null}
            {q.kind === "long" ? (
              <label className="ielts-quiz-long">
                {q.prompt ? (
                  <span className="ielts-quiz-stem">{q.prompt}</span>
                ) : null}
                <textarea
                  className={`dict-practice-input ielts-quiz-textarea${invalid ? " is-invalid" : ""}`}
                  value={value}
                  disabled={locked}
                  rows={10}
                  onChange={(e) => setValue(e.target.value)}
                />
                {!locked ? (
                  <span className="ielts-quiz-words">
                    {countWords(value)} words
                    {showErrors && countWords(value) < 20
                      ? " — at least 20"
                      : ""}
                  </span>
                ) : null}
              </label>
            ) : q.kind === "choice" ? (
              <div className={`ielts-quiz-mcq${invalid ? " is-invalid" : ""}`}>
                <div className="ielts-quiz-mcq-head">
                  <span className="ielts-quiz-n">{q.n}</span>
                  <span className="ielts-quiz-stem">{q.prompt}</span>
                </div>
                <div className="ielts-quiz-mcq-options" role="radiogroup">
                  {q.options.map((opt) => {
                    const selected = value === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`ielts-quiz-mcq-option${selected ? " is-selected" : ""}`}
                        disabled={locked}
                        aria-pressed={selected}
                        onClick={() => setValue(opt.id)}
                      >
                        <span className="ielts-quiz-mcq-letter">{opt.id}</span>
                        <span className="ielts-quiz-mcq-text">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <GapRow
                question={q}
                value={value}
                disabled={locked}
                invalid={invalid}
                onChange={setValue}
              />
            )}
          </div>
        );
      })}
      {showErrors && missing.length > 0 ? (
        <p className="ielts-quiz-need">Fill every question before checking.</p>
      ) : null}
      {paper.questions.length > 0 && !disabled ? (
        <div className="dict-practice-actions">
          <button
            type="button"
            className="dict-practice-primary"
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? "Checking…" : "Check"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
