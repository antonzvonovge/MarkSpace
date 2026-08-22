import { create } from "zustand";

export type BackgroundJobStatus = "running" | "paused" | "error" | "done";

export type BackgroundJob = {
  id: string;
  label: string;
  progress: number;
  status: BackgroundJobStatus;
  detail?: string;
  /** First seen (ms). Stable across progress updates so the status bar keeps FIFO order. */
  queuedAt?: number;
};

type BackgroundJobsState = {
  jobs: Record<string, BackgroundJob>;
  upsertJob: (job: BackgroundJob) => void;
  removeJob: (id: string) => void;
  visibleJobs: () => BackgroundJob[];
};

const DONE_HIDE_MS = 1500;
const doneTimers = new Map<string, number>();

export const useBackgroundJobsStore = create<BackgroundJobsState>((set, get) => ({
  jobs: {},

  upsertJob: (job) => {
    const prevTimer = doneTimers.get(job.id);
    if (prevTimer != null) {
      window.clearTimeout(prevTimer);
      doneTimers.delete(job.id);
    }

    set((state) => {
      const prev = state.jobs[job.id];
      const next: BackgroundJob = {
        ...job,
        queuedAt: prev?.queuedAt ?? job.queuedAt ?? Date.now(),
      };
      return { jobs: { ...state.jobs, [job.id]: next } };
    });

    if (job.status === "done") {
      const timer = window.setTimeout(() => {
        doneTimers.delete(job.id);
        get().removeJob(job.id);
      }, DONE_HIDE_MS);
      doneTimers.set(job.id, timer);
    }
  },

  removeJob: (id) => {
    set((state) => {
      if (!(id in state.jobs)) return state;
      const next = { ...state.jobs };
      delete next[id];
      return { jobs: next };
    });
  },

  visibleJobs: () => {
    return Object.values(get().jobs).filter(
      (j) => j.status === "running" || j.status === "error" || j.status === "done",
    );
  },
}));

export function applyBackgroundJobPayload(raw: unknown) {
  if (!raw || typeof raw !== "object") return;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  const label = typeof o.label === "string" ? o.label : null;
  const status = typeof o.status === "string" ? o.status : null;
  if (!id || !label || !status) return;
  if (
    status !== "running" &&
    status !== "paused" &&
    status !== "error" &&
    status !== "done"
  ) {
    return;
  }
  const progressRaw = o.progress;
  const progress =
    typeof progressRaw === "number" && Number.isFinite(progressRaw)
      ? Math.max(0, Math.min(100, Math.round(progressRaw)))
      : 0;
  const detail = typeof o.detail === "string" ? o.detail : undefined;
  useBackgroundJobsStore.getState().upsertJob({
    id,
    label,
    progress,
    status,
    detail,
  });
}
