import { useEffect, useRef, useState } from "react";
import {
  assessAzurePronunciation,
  transcribeIeltsSpeech,
} from "../../ai/ieltsAudio";
import {
  hasIeltsAzure,
  missingIeltsSttMessage,
  pickIeltsStt,
} from "../../ai/ieltsFit";
import {
  formatSpeakingNoteMarkdown,
  generateSpeakingOpening,
  generateSpeakingReply,
  gradeSpeakingSession,
  type SpeakingGradeResult,
  type SpeakingTurn,
} from "../../ai/ieltsSpeaking";
import { useAiSettingsStore } from "../../store/aiSettingsStore";

type Props = {
  existingTopics: string[];
  locked: boolean;
  onBusy: (busy: boolean) => void;
  onComplete: (params: {
    markdown: string;
    topicSlug: string;
    grade: SpeakingGradeResult;
  }) => Promise<void>;
};

export function IeltsSpeakingPanel({
  existingTopics,
  locked,
  onBusy,
  onComplete,
}: Props) {
  const settings = useAiSettingsStore((s) => s.settings);
  const [turns, setTurns] = useState<SpeakingTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needReply, setNeedReply] = useState(false);
  const started = useRef(false);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);

  const frozen = locked || busy;

  const setBusyBoth = (next: boolean) => {
    setBusy(next);
    onBusy(next);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setBusyBoth(true);
    void generateSpeakingOpening(existingTopics)
      .then((message) => {
        setTurns([{ role: "examiner", text: message }]);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusyBoth(false));
  }, [existingTopics]);

  const lastExaminer = [...turns].reverse().find((t) => t.role === "examiner");
  const candidateCount = turns.filter((t) => t.role === "candidate").length;

  const sendText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || frozen) return;
    setNeedReply(false);
    const next: SpeakingTurn[] = [
      ...turns,
      { role: "candidate", text: trimmed },
    ];
    setTurns(next);
    setDraft("");
    setBusyBoth(true);
    setError(null);
    try {
      const reply = await generateSpeakingReply(next);
      setTurns([...next, { role: "examiner", text: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyBoth(false);
    }
  };

  const toggleMic = () => {
    if (frozen) return;
    const rec = mediaRecRef.current;
    if (recording && rec && rec.state !== "inactive") {
      rec.stop();
      return;
    }
    if (!pickIeltsStt(settings)) {
      setError(missingIeltsSttMessage());
      return;
    }
    void (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      mediaChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) mediaChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        mediaRecRef.current = null;
        const blob = new Blob(mediaChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void (async () => {
          try {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const { text } = await transcribeIeltsSpeech({
              settings,
              bytes,
              mime: blob.type,
            });
            let payload = text;
            if (hasIeltsAzure(settings)) {
              try {
                const az = await assessAzurePronunciation({
                  settings,
                  bytes,
                  mime: blob.type,
                  referenceText: text,
                });
                if (az) {
                  payload += `\n\n[Azure pronunciation — accuracy ${az.accuracyScore ?? "–"}, fluency ${az.fluencyScore ?? "–"}, pronunciation ${az.pronunciationScore ?? "–"}]`;
                }
              } catch {
                /* optional */
              }
            }
            await sendText(payload);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        })();
      };
      mediaRecRef.current = recorder;
      setRecording(true);
      recorder.start();
    })().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  const endSession = async () => {
    if (frozen) return;
    if (candidateCount === 0) {
      setNeedReply(true);
      return;
    }
    setBusyBoth(true);
    setError(null);
    try {
      const grade = await gradeSpeakingSession(turns);
      const markdown = formatSpeakingNoteMarkdown({ grade, history: turns });
      await onComplete({ markdown, topicSlug: "speaking", grade });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyBoth(false);
    }
  };

  return (
    <div className={`ielts-quiz-speak${frozen ? " is-locked" : ""}`}>
      {lastExaminer ? (
        <p className="dict-practice-prompt">{lastExaminer.text}</p>
      ) : (
        <p className="dict-practice-status">Starting…</p>
      )}
      {candidateCount > 0 ? (
        <p className="ielts-quiz-speak-meta">{candidateCount} replies</p>
      ) : null}
      <textarea
        className="dict-practice-input ielts-quiz-textarea"
        rows={3}
        value={draft}
        disabled={frozen}
        placeholder="Your answer"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void sendText(draft);
          }
        }}
      />
      {needReply ? (
        <p className="ielts-quiz-need">Answer at least once before ending.</p>
      ) : null}
      {error ? <p className="ielts-quiz-need">{error}</p> : null}
      <div className="dict-practice-actions ielts-quiz-speak-actions">
        <button
          type="button"
          className="dict-practice-primary"
          disabled={frozen || !draft.trim()}
          onClick={() => void sendText(draft)}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
      <div className="dict-practice-skip">
        <button
          type="button"
          className="dict-practice-ghost"
          disabled={frozen}
          onClick={toggleMic}
        >
          {recording ? "Stop mic" : "Microphone"}
        </button>
        <button
          type="button"
          className="dict-practice-ghost"
          disabled={frozen}
          onClick={() => void endSession()}
        >
          End
        </button>
      </div>
    </div>
  );
}
