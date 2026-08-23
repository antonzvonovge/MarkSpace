import { useEffect, useMemo, useRef, useState } from "react";
import { synthesizeIeltsListening } from "../../ai/ieltsAudio";
import {
  defaultIeltsTimerSeconds,
  formatIeltsGradeMarkdown,
  generateListeningPaper,
  generateReadingPaper,
  generateWritingPaper,
  gradeIeltsPaper,
  type GeneratedIeltsPaper,
  type IeltsGradeResult,
} from "../../ai/ieltsGenerate";
import {
  missingIeltsTtsMessage,
  pickIeltsTts,
  type IeltsSkill,
} from "../../ai/ieltsFit";
import type { SpeakingGradeResult } from "../../ai/ieltsSpeaking";
import {
  ieltsSessionTarget,
  listExistingSessionNotes,
  listSessionTopics,
  saveIeltsSessionNote,
  writeIeltsSessionAudio,
  type IeltsSessionTarget,
} from "../../ai/ieltsSession";
import type { IeltsPaperAnswerItem } from "../../ai/ieltsPaper";
import { deleteFolderIfEmpty, deletePath, readNote } from "../../lib/vaultApi";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useVaultStore } from "../../store/vaultStore";
import { DialogShell } from "../AppDialog";
import { VaultFolderBrowseDialog } from "../VaultFolderBrowseDialog";
import { Select } from "../ui/Select";
import { AudioPlayer } from "../audio/AudioPlayer";
import { IeltsPaperView } from "./IeltsPaperView";
import { IeltsSpeakingPanel } from "./IeltsSpeakingPanel";

type Phase = "setup" | "preparing" | "practice" | "checking" | "recap";

type Props = {
  open: boolean;
  skill: IeltsSkill;
  projectPath: string;
  /** Folder that was right-clicked in the tree. */
  folderPath: string;
  onClose: () => void;
};

const READING_OPTIONS = [
  { value: "section-1", label: "Section 1" },
  { value: "section-2", label: "Section 2" },
  { value: "section-3", label: "Section 3" },
  { value: "mini", label: "Mini-set" },
];

const WRITING_OPTIONS = [
  { value: "t1-formal", label: "Task 1 — formal letter" },
  { value: "t1-semi", label: "Task 1 — semi-formal letter" },
  { value: "t1-informal", label: "Task 1 — informal letter" },
  { value: "t2-opinion", label: "Task 2 — opinion" },
  { value: "t2-discussion", label: "Task 2 — discussion" },
  { value: "t2-problem", label: "Task 2 — problem / solution" },
  { value: "t2-advantages", label: "Task 2 — advantages / disadvantages" },
  { value: "rewrite", label: "Rewrite a previous piece" },
];

const LISTENING_OPTIONS = [
  { value: "section-1", label: "Section 1 (1–10)" },
  { value: "section-2", label: "Section 2 (11–20)" },
  { value: "section-3", label: "Section 3 (21–30)" },
  { value: "section-4", label: "Section 4 (31–40)" },
  { value: "sections-1-4", label: "Full test (1–40)" },
];

function skillTitle(skill: IeltsSkill): string {
  return `IELTS ${skill[0]!.toUpperCase()}${skill.slice(1)}`;
}

function formatCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function IeltsTrainerDialog({
  open,
  skill,
  projectPath,
  folderPath,
  onClose,
}: Props) {
  const settings = useAiSettingsStore((s) => s.settings);
  const [folder, setFolder] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [variant, setVariant] = useState("section-1");
  const [rewritePath, setRewritePath] = useState("");
  const [rewriteNotes, setRewriteNotes] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("setup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedIeltsPaper | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [grade, setGrade] = useState<IeltsGradeResult | null>(null);
  const [speakingGrade, setSpeakingGrade] = useState<SpeakingGradeResult | null>(
    null,
  );
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [topics, setTopics] = useState<string[]>([]);
  const [waitHint, setWaitHint] = useState("");

  const variantOptions = useMemo(() => {
    if (skill === "writing") return WRITING_OPTIONS;
    if (skill === "listening") return LISTENING_OPTIONS;
    if (skill === "reading") return READING_OPTIONS;
    return [];
  }, [skill]);

  const canStart =
    Boolean(folder) &&
    (skill !== "writing" || variant !== "rewrite" || Boolean(rewritePath));

  // Reset only when the dialog opens or the target changes — not when the
  // vault tree refreshes (Listening writes audio first; a tree subscription
  // would otherwise bounce the UI back to setup).
  useEffect(() => {
    if (!open) return;
    const clicked = folderPath.replace(/^\/+|\/+$/g, "");
    const project = projectPath.replace(/^\/+|\/+$/g, "");
    setFolder(clicked || project);
    setPhase("setup");
    setBusy(false);
    setError(null);
    setGenerated(null);
    setAudioPath(null);
    targetRef.current = null;
    savedRef.current = false;
    setGrade(null);
    setSpeakingGrade(null);
    setTimerEndsAt(null);
    setRewritePath("");
    setWaitHint("");
    if (skill === "writing") setVariant("t1-formal");
    else setVariant("section-1");
  }, [open, projectPath, folderPath, skill]);

  useEffect(() => {
    if (!open || !folder) return;
    void listSessionTopics(folder).then(setTopics);
    if (skill === "writing") {
      void listExistingSessionNotes(folder).then(setRewriteNotes);
    }
  }, [open, folder, skill]);

  useEffect(() => {
    if (!timerEndsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timerEndsAt]);

  const runId = useRef(0);
  const targetRef = useRef<IeltsSessionTarget | null>(null);
  const savedRef = useRef(false);

  const remain =
    timerEndsAt != null ? Math.ceil((timerEndsAt - now) / 1000) : 0;

  /** Audio is written before practice; drop it when the session is abandoned. */
  const discardUnsavedAudio = () => {
    const target = targetRef.current;
    const path = audioPath;
    targetRef.current = null;
    if (savedRef.current || !path) return;
    void (async () => {
      try {
        await deletePath(path);
        if (target) await deleteFolderIfEmpty(target.dest);
      } catch {
        /* leftover clip is harmless */
      }
    })();
  };

  const requestClose = () => {
    runId.current += 1;
    discardUnsavedAudio();
    onClose();
  };

  const startPractice = async () => {
    if (busy) return;
    if (!folder) {
      setError("Choose a folder.");
      return;
    }
    if (skill === "writing" && variant === "rewrite" && !rewritePath) {
      setError("Choose a note to rewrite.");
      return;
    }
    if (skill === "listening" && !pickIeltsTts(settings)) {
      setError(missingIeltsTtsMessage());
      return;
    }
    setBusy(true);
    setError(null);
    if (skill !== "speaking") setPhase("preparing");
    const id = ++runId.current;
    const hint = (message: string) => {
      if (id === runId.current) setWaitHint(message);
    };
    try {
      hint("Looking up previous topics…");
      const existing = await listSessionTopics(folder);
      if (id !== runId.current) return;
      setTopics(existing);
      if (skill === "speaking") {
        setPhase("practice");
        return;
      }
      let paper: GeneratedIeltsPaper;
      if (skill === "reading") {
        hint("Writing the paper…");
        paper = await generateReadingPaper({
          variant,
          existingTopics: existing,
        });
      } else if (skill === "writing") {
        let previousMarkdown = "";
        if (variant === "rewrite") {
          hint("Reading the previous note…");
          previousMarkdown = await readNote(rewritePath);
        }
        hint("Writing the prompt…");
        paper = await generateWritingPaper({
          variant,
          existingTopics: existing,
          previousMarkdown,
        });
      } else {
        hint("Writing the paper and script…");
        paper = await generateListeningPaper({
          variant,
          existingTopics: existing,
        });
        const audio = await synthesizeIeltsListening({
          settings,
          lines: paper.lines,
          onStatus: hint,
        });
        if (id !== runId.current) return;
        hint("Saving the audio…");
        const target = ieltsSessionTarget({
          skill,
          folder,
          variant: paper.topicSlug || variant,
        });
        const written = await writeIeltsSessionAudio(
          target,
          audio.filename,
          audio.bytes,
        );
        targetRef.current = target;
        setAudioPath(written);
      }
      if (id !== runId.current) return;
      setGenerated(paper);
      const seconds = defaultIeltsTimerSeconds(skill, variant);
      setTimerEndsAt(seconds > 0 ? Date.now() + seconds * 1000 : null);
      setPhase("practice");
    } catch (e) {
      if (id !== runId.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("setup");
    } finally {
      if (id === runId.current) setBusy(false);
    }
  };

  const persist = async (markdown: string, topicSlug: string) => {
    setWaitHint("Saving the session note…");
    const target =
      targetRef.current ??
      ieltsSessionTarget({ skill, folder, variant: topicSlug || variant });
    targetRef.current = target;
    await saveIeltsSessionNote({ target, markdown });
    savedRef.current = true;
    setPhase("recap");
  };

  const onSubmitPaper = async (answers: IeltsPaperAnswerItem[]) => {
    if (!generated || busy) return;
    setBusy(true);
    setError(null);
    setPhase("checking");
    setWaitHint("Checking answers…");
    const id = ++runId.current;
    try {
      const result = await gradeIeltsPaper({
        skill,
        paper: generated.paper,
        answers,
        answerKey: generated.answerKey,
        script: generated.script,
      });
      if (id !== runId.current) return;
      setGrade(result);
      const audioName = audioPath?.split("/").pop() ?? "";
      const audioWiki = audioName ? `![[${audioName}]]` : "";
      await persist(
        formatIeltsGradeMarkdown({
          skill,
          paper: generated.paper,
          grade: result,
          answerKey: generated.answerKey,
          script: generated.script,
          lines: generated.lines,
          audioWiki: audioWiki || undefined,
        }),
        generated.topicSlug,
      );
    } catch (e) {
      if (id !== runId.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("practice");
    } finally {
      if (id === runId.current) setBusy(false);
    }
  };

  const waiting = phase === "preparing" || phase === "checking";

  return (
    <>
      <DialogShell
        open={open}
        title={skillTitle(skill)}
        onCancel={requestClose}
        className={`ielts-quiz${waiting ? " is-busy" : ""}${
          phase === "practice" && audioPath ? " has-dock" : ""
        }`}
        showClose
        footer={
          waiting || phase === "practice"
            ? undefined
            : phase === "setup"
              ? (
            <>
              <button
                type="button"
                className="dict-practice-ghost"
                onClick={requestClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dict-practice-primary"
                disabled={!canStart}
                onClick={() => void startPractice()}
              >
                Start
              </button>
            </>
          ) : (
            <button
              type="button"
              className="dict-practice-primary"
              onClick={onClose}
            >
              Done
            </button>
          )
        }
      >
        <div className="app-dialog-body ielts-quiz-body">
          {phase === "preparing" ? (
            <div className="ielts-quiz-wait">
              <p className="dict-practice-status">Preparing…</p>
              {waitHint ? (
                <p className="ielts-quiz-wait-hint">{waitHint}</p>
              ) : null}
            </div>
          ) : null}

          {phase === "setup" ? (
            <div className="ielts-quiz-setup">
              <div className="ielts-quiz-field">
                <div className="app-dialog-label">Folder</div>
                <div className="ielts-quiz-folder-row">
                  <div className="ielts-quiz-folder" title={folder}>
                    {folder || "—"}
                  </div>
                  <button
                    type="button"
                    className="app-dialog-btn"
                    onClick={() => setBrowseOpen(true)}
                  >
                    Browse…
                  </button>
                </div>
              </div>
              {variantOptions.length > 0 ? (
                <div className="ielts-quiz-field">
                  <div className="app-dialog-label">Variant</div>
                  <Select
                    variant="field"
                    value={variant}
                    options={variantOptions}
                    onChange={setVariant}
                  />
                </div>
              ) : null}
              {skill === "writing" && variant === "rewrite" ? (
                <div className="ielts-quiz-field">
                  <div className="app-dialog-label">Note</div>
                  <Select
                    variant="field"
                    value={rewritePath}
                    options={[
                      { value: "", label: "Choose a note…" },
                      ...rewriteNotes.map((name) => ({
                        value: folder ? `${folder}/${name}` : name,
                        label: name,
                      })),
                    ]}
                    onChange={setRewritePath}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === "practice" && skill === "speaking" ? (
            <IeltsSpeakingPanel
              existingTopics={topics}
              locked={busy}
              onBusy={setBusy}
              onComplete={async ({ markdown, topicSlug, grade: g }) => {
                setSpeakingGrade(g);
                await persist(markdown, topicSlug);
              }}
            />
          ) : null}

          {phase === "checking" ? (
            <div className="ielts-quiz-wait">
              <p className="dict-practice-status">Checking…</p>
              {waitHint ? (
                <p className="ielts-quiz-wait-hint">{waitHint}</p>
              ) : null}
            </div>
          ) : null}

          {phase === "practice" && generated && skill !== "speaking" ? (
            <div className="ielts-quiz-practice">
              <div className="ielts-quiz-dock">
                {timerEndsAt != null && remain > 0 ? (
                  <div className="ielts-quiz-timer">{formatCountdown(remain)}</div>
                ) : null}
                {skill === "listening" && audioPath ? (
                  <AudioPlayer path={audioPath} />
                ) : null}
              </div>
              <div className="ielts-quiz-practice-scroll">
                <IeltsPaperView
                  paper={generated.paper}
                  submitting={busy}
                  onSubmit={(a) => void onSubmitPaper(a)}
                />
              </div>
            </div>
          ) : null}

          {phase === "recap" && grade ? (
            <div className="ielts-quiz-recap">
              <p className="dict-practice-status">
                {grade.correct}/{grade.total}
              </p>
              {grade.recap ? (
                <p className="ielts-quiz-recap-text">{grade.recap}</p>
              ) : null}
              {grade.items && grade.items.length > 0 ? (
                <ul className="ielts-quiz-recap-list">
                  {grade.items.map((item) => (
                    <li key={item.n}>
                      <strong>{item.n}</strong> {item.yours || "—"}
                      {item.correct ? ` → ${item.correct}` : ""}
                      {item.trap ? ` · ${item.trap}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {phase === "recap" && speakingGrade ? (
            <div className="ielts-quiz-recap">
              <p className="dict-practice-status">
                {speakingGrade.fluency} · {speakingGrade.lr} · {speakingGrade.gra}
              </p>
              <p className="ielts-quiz-recap-text">{speakingGrade.recap}</p>
              {speakingGrade.fixes.length > 0 ? (
                <ul className="ielts-quiz-recap-list">
                  {speakingGrade.fixes.map((fix) => (
                    <li key={fix}>{fix}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {error && !waiting ? <p className="ielts-quiz-need">{error}</p> : null}
        </div>
      </DialogShell>
      <VaultFolderBrowseDialog
        open={browseOpen}
        nested={true}
        rootPath={projectPath}
        selectedPath={folder || projectPath}
        onCancel={() => setBrowseOpen(false)}
        onChoose={(next) => {
          setFolder(next);
          setBrowseOpen(false);
        }}
      />
    </>
  );
}
