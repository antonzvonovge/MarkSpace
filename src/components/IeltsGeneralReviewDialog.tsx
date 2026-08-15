import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { credentialsFromSettings } from "../ai/languageModel";
import {
  formatIeltsBand,
  IELTS_CRITERION_LABEL,
  IELTS_REVIEW_MAX_CHARS,
  ieltsGeneralReview,
  type IeltsCriterion,
  type IeltsGeneralReviewResult,
} from "../ai/ieltsGeneralReview";
import { focusActiveMarkdownEditor } from "../editor/completedTasksCommand";
import { nativeLanguageLabel } from "../settings/types";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { helperModelCallParams } from "../store/vaultAiSettingsStore";
import { usePrefsStore } from "../store/prefsStore";
import { DialogShell } from "./AppDialog";

const CRITERION_NAME: Record<IeltsCriterion, string> = {
  cc: "Coherence",
  lr: "Lexical",
  gra: "Grammar",
};

type Props = {
  open: boolean;
  initialText?: string;
  onClose: () => void;
};

export function IeltsGeneralReviewDialog({
  open,
  initialText = "",
  onClose,
}: Props) {
  const abortRef = useRef<AbortController | null>(null);
  const wasOpenRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IeltsGeneralReviewResult | null>(null);
  const [empty, setEmpty] = useState(false);

  const aiSettings = useAiSettingsStore((s) => s.settings);
  const nativeLanguage = usePrefsStore((s) => s.prefs.nativeLanguage);

  const runReview = async (source: string) => {
    const trimmed = source.trim().slice(0, IELTS_REVIEW_MAX_CHARS);
    if (!trimmed) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const next = await ieltsGeneralReview({
        text: trimmed,
        nativeLanguageCode: nativeLanguage,
        nativeLanguageLabel: nativeLanguageLabel(nativeLanguage),
        keys: credentialsFromSettings(aiSettings),
        ...helperModelCallParams(),
        abortSignal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setResult(next);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      return;
    }
    const next = initialText.trim().slice(0, IELTS_REVIEW_MAX_CHARS);
    setError(null);
    setResult(null);
    setEmpty(!next);
    if (next) void runReview(next);
    return () => {
      abortRef.current?.abort();
    };
    // Auto-run only when the dialog opens with a selection, not when settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialText]);

  useLayoutEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    focusActiveMarkdownEditor();
  }, [open]);

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  return (
    <DialogShell
      open={open}
      title="IELTS General writing review"
      description="Indicative General Training scores. Not an official band."
      className="ielts-review-dialog"
      onCancel={close}
      footer={
        <button type="button" className="app-dialog-btn" onClick={close}>
          Close
        </button>
      }
    >
      <div className="app-dialog-body ielts-review-body">
        {empty ? (
          <p className="ielts-review-empty">
            Select English text in a note, then run this command again.
          </p>
        ) : null}

        {busy && !result ? (
          <div className="ielts-review-loading" aria-live="polite">
            <div className="ielts-review-scoreboard is-pending">
              <div className="ielts-review-overall-block">
                <div className="ielts-review-overall-label">Overall</div>
                <div className="ielts-review-overall-value">–</div>
              </div>
              <div className="ielts-review-band-grid">
                {(["cc", "lr", "gra"] as const).map((id) => (
                  <div key={id} className="ielts-review-band">
                    <span className="ielts-review-band-name">
                      {CRITERION_NAME[id]}
                    </span>
                    <span className="ielts-review-band-value">–</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="ielts-review-status">Reviewing…</p>
          </div>
        ) : null}

        {result ? (
          <div className="ielts-review-card" aria-live="polite">
            <div className="ielts-review-scoreboard">
              <div className="ielts-review-overall-block">
                <div className="ielts-review-overall-label">Overall</div>
                <div className="ielts-review-overall-value">
                  {formatIeltsBand(result.overall)}
                </div>
                <div className="ielts-review-indicative">
                  Indicative · not official
                </div>
              </div>
              <div className="ielts-review-band-grid">
                {(
                  [
                    ["cc", result.cc],
                    ["lr", result.lr],
                    ["gra", result.gra],
                  ] as const
                ).map(([id, score]) => (
                  <div key={id} className="ielts-review-band">
                    <span className="ielts-review-band-name">
                      {CRITERION_NAME[id]}
                    </span>
                    <span className="ielts-review-band-value">
                      {formatIeltsBand(score)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {result.issues.length > 0 ? (
              <div className="ielts-review-section">
                <div className="ielts-review-section-label">Issues</div>
                <ul className="ielts-review-issues">
                  {result.issues.map((issue, i) => (
                    <li key={`${issue.criterion}-${i}`}>
                      <span className="ielts-review-criterion">
                        {IELTS_CRITERION_LABEL[issue.criterion]}
                        <span className="ielts-review-criterion-name">
                          {CRITERION_NAME[issue.criterion]}
                        </span>
                      </span>
                      {issue.quote ? (
                        <span className="ielts-review-quote">
                          {issue.quote}
                        </span>
                      ) : null}
                      <span className="ielts-review-problem">
                        {issue.problem}
                      </span>
                      {issue.fix ? (
                        <span className="ielts-review-fix">
                          <span className="ielts-review-fix-label">Fix</span>
                          {issue.fix}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.recommendations.length > 0 ? (
              <div className="ielts-review-section">
                <div className="ielts-review-section-label">
                  Recommendations
                </div>
                <ul className="ielts-review-tips">
                  {result.recommendations.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.rewrite ? (
              <div className="ielts-review-section">
                <div className="ielts-review-section-label">Rewrite</div>
                <p className="ielts-review-rewrite">{result.rewrite}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="link-dialog-suggest-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </DialogShell>
  );
}
