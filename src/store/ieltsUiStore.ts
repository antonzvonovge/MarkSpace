import { create } from "zustand";
import type { IeltsSkill } from "../ai/ieltsFit";
import type { AzurePronunciationResult } from "../ai/ieltsAudio";

export type IeltsSession = {
  threadId: string;
  skill: IeltsSkill;
  folder: string;
  variant: string;
  awaitingSubmit: boolean;
  timerLabel: string;
  timerSeconds: number;
  timerEndsAt: number | null;
  audioPaths: string[];
  notePath: string | null;
  muteExaminer: boolean;
  lastPronunciation: AzurePronunciationResult | null;
  listeningPlaybackEnded: boolean;
};

type IeltsUiState = {
  session: IeltsSession | null;
  recording: boolean;
  pendingThreadId: string | null;
  setPendingThreadId: (id: string | null) => void;
  startSession: (partial: Omit<IeltsSession, "awaitingSubmit" | "timerLabel" | "timerSeconds" | "timerEndsAt" | "audioPaths" | "notePath" | "muteExaminer" | "lastPronunciation" | "listeningPlaybackEnded"> & Partial<IeltsSession>) => void;
  patch: (partial: Partial<IeltsSession>) => void;
  setRecording: (recording: boolean) => void;
  clear: () => void;
};

const secrets = new Map<
  string,
  { answerKey: string; script: string }
>();

export function ieltsSecretKey(threadId: string): string {
  return threadId;
}

export function setIeltsSecret(
  threadId: string,
  secret: { answerKey: string; script: string },
): void {
  secrets.set(threadId, secret);
}

export function getIeltsSecret(threadId: string): {
  answerKey: string;
  script: string;
} | null {
  return secrets.get(threadId) ?? null;
}

export function clearIeltsSecret(threadId: string): void {
  secrets.delete(threadId);
}

export const useIeltsUiStore = create<IeltsUiState>((set, get) => ({
  session: null,
  recording: false,
  pendingThreadId: null,
  setPendingThreadId: (id) => set({ pendingThreadId: id }),
  startSession: (partial) => {
    set({
      session: {
        awaitingSubmit: true,
        timerLabel: "",
        timerSeconds: 0,
        timerEndsAt: null,
        audioPaths: [],
        notePath: null,
        muteExaminer: false,
        lastPronunciation: null,
        listeningPlaybackEnded: false,
        ...partial,
      },
    });
  },
  patch: (partial) => {
    const cur = get().session;
    if (!cur) return;
    set({ session: { ...cur, ...partial } });
  },
  setRecording: (recording) => set({ recording }),
  clear: () => set({ session: null, recording: false }),
}));
