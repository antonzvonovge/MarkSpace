import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DICT_KNOWN_THRESHOLD,
  correctCountFor,
  getDictProgress,
  markDictEntryKnown,
  markDictEntryUnknown,
  recordDictCorrectAnswer,
  type DictProgressDoc,
} from "../../lib/dictProgress";
import { useVaultStore } from "../../store/vaultStore";
import {
  answersMatch,
  loadPracticeDeck,
  type PracticeCard,
} from "./dictPractice";

type Props = {
  open: boolean;
  projectPath: string;
  onClose: () => void;
  onProgressChange?: () => void;
};

export function DictPracticeDialog({
  open,
  projectPath,
  onClose,
  onProgressChange,
}: Props) {
  // Subscribe only while open so tree updates do not re-render App shell.
  const tree = useVaultStore((s) => (open ? s.tree : null));
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deck, setDeck] = useState<PracticeCard[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "correct" | "wrong">(
    "idle",
  );
  const [progress, setProgress] = useState<DictProgressDoc | null>(null);
  const [becameKnown, setBecameKnown] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDeck([]);
    setIndex(0);
    setAnswer("");
    setFeedback("idle");
    setBecameKnown(false);
    void (async () => {
      try {
        const [cards, prog] = await Promise.all([
          loadPracticeDeck(tree, projectPath),
          getDictProgress(projectPath),
        ]);
        if (cancelled) return;
        setDeck(cards);
        setProgress(prog);
        if (cards.length === 0) {
          setError("Nothing to practice — all words are known.");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, tree]);

  const feedbackRef = useRef(feedback);
  const loadingRef = useRef(loading);
  const deckRef = useRef(deck);
  const indexRef = useRef(index);
  const answerRef = useRef(answer);
  const cardRef = useRef<PracticeCard | null>(null);
  feedbackRef.current = feedback;
  loadingRef.current = loading;
  deckRef.current = deck;
  indexRef.current = index;
  answerRef.current = answer;

  const refreshProgress = useCallback(async () => {
    const prog = await getDictProgress(projectPath);
    setProgress(prog);
    onProgressChange?.();
  }, [onProgressChange, projectPath]);

  const goNext = useCallback(() => {
    setAnswer("");
    setFeedback("idle");
    setBecameKnown(false);
    if (indexRef.current + 1 >= deckRef.current.length) {
      onClose();
      return;
    }
    setIndex((i) => i + 1);
  }, [onClose]);

  const checkingRef = useRef(false);

  const onCheck = useCallback(async () => {
    const card = cardRef.current;
    if (!card || feedbackRef.current !== "idle" || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const ok = answersMatch(card.answer, answerRef.current);
      if (ok) {
        const result = await recordDictCorrectAnswer(
          projectPath,
          card.dictPath,
          card.word,
        );
        setBecameKnown(result.becameKnown);
        await refreshProgress();
        setFeedback("correct");
      } else {
        setFeedback("wrong");
      }
    } finally {
      checkingRef.current = false;
    }
  }, [projectPath, refreshProgress]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Enter") return;
      if (loadingRef.current) return;
      if (e.isComposing) return;
      e.preventDefault();
      if (feedbackRef.current === "idle") {
        void onCheck();
      } else {
        goNext();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, onCheck, goNext]);

  useEffect(() => {
    if (!open || loading) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, loading, index, feedback]);

  if (!open) return null;

  const card = deck[index] ?? null;
  cardRef.current = card;
  const count = card
    ? correctCountFor(progress, card.dictPath, card.word)
    : 0;
  const filled = Math.min(count, DICT_KNOWN_THRESHOLD);

  const onMarkKnown = async () => {
    if (!card) return;
    await markDictEntryKnown(projectPath, card.dictPath, card.word);
    await refreshProgress();
    goNext();
  };

  const onMarkUnknown = async () => {
    if (!card) return;
    await markDictEntryUnknown(projectPath, card.dictPath, card.word);
    await refreshProgress();
    setBecameKnown(false);
    setFeedback("idle");
  };

  const stageClass =
    feedback === "correct"
      ? "dict-practice is-correct"
      : feedback === "wrong"
        ? "dict-practice is-wrong"
        : "dict-practice";

  return createPortal(
    <div className="dict-practice-root" role="presentation">
      <button
        type="button"
        className="dict-practice-backdrop"
        aria-label="Close practice"
        onClick={onClose}
      />
      <div
        className={stageClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          type="button"
          className="dict-practice-exit"
          onClick={onClose}
          aria-label="Close"
        >
          Esc
        </button>

        {loading ? (
          <p className="dict-practice-status" id={titleId}>
            Shuffling…
          </p>
        ) : error ? (
          <div className="dict-practice-empty">
            <p className="dict-practice-status" id={titleId}>
              {error}
            </p>
            <button
              type="button"
              className="dict-practice-primary"
              onClick={onClose}
            >
              Back
            </button>
          </div>
        ) : card ? (
          <>
            <div className="dict-practice-top" id={titleId}>
              <div
                className="dict-practice-pips"
                aria-label={`${filled} of ${DICT_KNOWN_THRESHOLD}`}
              >
                {Array.from({ length: DICT_KNOWN_THRESHOLD }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < filled
                        ? "dict-practice-pip is-on"
                        : "dict-practice-pip"
                    }
                  />
                ))}
              </div>
              <span className="dict-practice-count">
                {index + 1}/{deck.length}
              </span>
            </div>

            <p className="dict-practice-prompt">{card.prompt}</p>

            {card.kind === "cloze" && card.translation.trim() ? (
              <p className="dict-practice-hint">{card.translation}</p>
            ) : null}

            <input
              ref={inputRef}
              type="text"
              className="dict-practice-input"
              value={answer}
              readOnly={feedback !== "idle"}
              placeholder="Type here"
              aria-label="Your answer"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setAnswer(e.target.value)}
            />

            <div className="dict-practice-result" aria-live="polite">
              {feedback === "correct" ? (
                <span>{becameKnown ? "Known!" : "Nice!"}</span>
              ) : null}
              {feedback === "wrong" ? (
                <span>
                  It’s <strong>{card.answer}</strong>
                </span>
              ) : null}
            </div>

            {feedback !== "idle" && card.examples.length > 0 ? (
              <ul className="dict-practice-examples">
                {card.examples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            ) : null}

            <div className="dict-practice-actions">
              {feedback === "idle" ? (
                <button
                  type="button"
                  className="dict-practice-primary"
                  onClick={() => void onCheck()}
                >
                  Check
                </button>
              ) : (
                <button
                  type="button"
                  className="dict-practice-primary"
                  onClick={goNext}
                >
                  {index + 1 >= deck.length ? "Done" : "Next →"}
                </button>
              )}
            </div>

            <div className="dict-practice-skip">
              <button
                type="button"
                className="dict-practice-ghost"
                onClick={() => void onMarkKnown()}
              >
                I know this
              </button>
              <button
                type="button"
                className="dict-practice-ghost"
                onClick={() => void onMarkUnknown()}
              >
                Reset
              </button>
            </div>
          </>
        ) : (
          <div className="dict-practice-empty">
            <p className="dict-practice-status" id={titleId}>
              You’re done!
            </p>
            <button
              type="button"
              className="dict-practice-primary"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
