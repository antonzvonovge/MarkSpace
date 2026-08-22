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
};

const DONE_HIDE_MS = 1500;
const doneTimers = new Map<string, number>();

/**
 * Progress ticks are coalesced to one store write per frame.
 *
 * Sources like note indexing and article clipping report on every file or
 * image, and each of those would otherwise be its own React render.
 */
const pendingUpdates = new Map<string, BackgroundJob>();
let flushHandle = 0;

function applyJobs(batch: BackgroundJob[]) {
  if (batch.length === 0) return;
  useBackgroundJobsStore.setState((state) => {
    const jobs = { ...state.jobs };
    for (const job of batch) {
      const prev = jobs[job.id];
      jobs[job.id] = {
        ...job,
        queuedAt: prev?.queuedAt ?? job.queuedAt ?? Date.now(),
      };
    }
    return { jobs };
  });
}

/** Exported for tests; production code goes through the frame callback. */
export function flushBackgroundJobUpdates() {
  if (flushHandle) {
    cancelAnimationFrame(flushHandle);
    flushHandle = 0;
  }
  if (pendingUpdates.size === 0) return;
  const batch = [...pendingUpdates.values()];
  pendingUpdates.clear();
  applyJobs(batch);
}

function scheduleFlush() {
  if (flushHandle) return;
  flushHandle = requestAnimationFrame(() => {
    flushHandle = 0;
    flushBackgroundJobUpdates();
  });
}

export const useBackgroundJobsStore = create<BackgroundJobsState>((set, get) => ({
  jobs: {},

  upsertJob: (job) => {
    const prevTimer = doneTimers.get(job.id);
    if (prevTimer != null) {
      window.clearTimeout(prevTimer);
      doneTimers.delete(job.id);
    }

    if (job.status === "running" || job.status === "paused") {
      pendingUpdates.set(job.id, job);
      scheduleFlush();
      return;
    }

    // Terminal states land right away, and drop any queued tick that would
    // otherwise overwrite them a frame later.
    pendingUpdates.delete(job.id);
    applyJobs([job]);

    if (job.status === "done") {
      const timer = window.setTimeout(() => {
        doneTimers.delete(job.id);
        get().removeJob(job.id);
      }, DONE_HIDE_MS);
      doneTimers.set(job.id, timer);
    }
  },

  removeJob: (id) => {
    pendingUpdates.delete(id);
    set((state) => {
      if (!(id in state.jobs)) return state;
      const next = { ...state.jobs };
      delete next[id];
      return { jobs: next };
    });
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
