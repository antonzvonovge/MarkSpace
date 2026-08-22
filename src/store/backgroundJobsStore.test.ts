import { beforeEach, describe, expect, it } from "vitest";
import { selectVisibleJobs } from "../components/BackgroundJobsList";
import {
  applyBackgroundJobPayload,
  flushBackgroundJobUpdates,
  useBackgroundJobsStore,
} from "./backgroundJobsStore";

function running(progress: number, detail?: string) {
  return {
    id: "embeddings-index",
    label: "Indexing notes",
    progress,
    status: "running" as const,
    detail,
  };
}

describe("backgroundJobsStore", () => {
  beforeEach(() => {
    flushBackgroundJobUpdates();
    useBackgroundJobsStore.setState({ jobs: {} });
    flushBackgroundJobUpdates();
    useBackgroundJobsStore.setState({ jobs: {} });
  });

  it("does not write to the store until the frame flushes", () => {
    const { upsertJob } = useBackgroundJobsStore.getState();
    upsertJob(running(10));
    expect(useBackgroundJobsStore.getState().jobs).toEqual({});
    flushBackgroundJobUpdates();
    expect(
      useBackgroundJobsStore.getState().jobs["embeddings-index"].progress,
    ).toBe(10);
  });

  it("collapses a burst of progress ticks into one store write", () => {
    const { upsertJob } = useBackgroundJobsStore.getState();
    let writes = 0;
    const unsub = useBackgroundJobsStore.subscribe(() => {
      writes += 1;
    });
    for (let i = 1; i <= 40; i++) upsertJob(running(i));
    flushBackgroundJobUpdates();
    unsub();
    expect(writes).toBe(1);
    expect(
      useBackgroundJobsStore.getState().jobs["embeddings-index"].progress,
    ).toBe(40);
  });

  it("applies terminal states immediately", () => {
    const { upsertJob } = useBackgroundJobsStore.getState();
    upsertJob({
      id: "clip",
      label: "Clipping",
      progress: 100,
      status: "error",
      detail: "boom",
    });
    expect(useBackgroundJobsStore.getState().jobs.clip.status).toBe("error");
  });

  it("does not let a queued tick resurrect a finished job", () => {
    const { upsertJob } = useBackgroundJobsStore.getState();
    upsertJob(running(90));
    upsertJob({
      id: "embeddings-index",
      label: "Indexing notes",
      progress: 100,
      status: "done",
    });
    flushBackgroundJobUpdates();
    expect(
      useBackgroundJobsStore.getState().jobs["embeddings-index"].status,
    ).toBe("done");
  });

  it("keeps queuedAt stable across progress updates", () => {
    const { upsertJob } = useBackgroundJobsStore.getState();
    upsertJob(running(5));
    flushBackgroundJobUpdates();
    const first =
      useBackgroundJobsStore.getState().jobs["embeddings-index"].queuedAt;
    upsertJob(running(50));
    flushBackgroundJobUpdates();
    expect(
      useBackgroundJobsStore.getState().jobs["embeddings-index"].queuedAt,
    ).toBe(first);
  });

  it("shows paused jobs in the status bar", () => {
    applyBackgroundJobPayload({
      id: "embeddings-index",
      label: "Indexing notes",
      progress: 42,
      status: "paused",
      detail: "Paused while you work",
    });
    flushBackgroundJobUpdates();
    const visible = selectVisibleJobs(useBackgroundJobsStore.getState().jobs);
    expect(visible.map((j) => j.status)).toEqual(["paused"]);
    expect(visible[0].detail).toBe("Paused while you work");
  });

  it("ignores payloads with an unknown status", () => {
    applyBackgroundJobPayload({
      id: "x",
      label: "X",
      progress: 1,
      status: "sleeping",
    });
    flushBackgroundJobUpdates();
    expect(useBackgroundJobsStore.getState().jobs).toEqual({});
  });

  it("drops queued ticks when the job is removed", () => {
    const { upsertJob, removeJob } = useBackgroundJobsStore.getState();
    upsertJob(running(30));
    removeJob("embeddings-index");
    flushBackgroundJobUpdates();
    expect(useBackgroundJobsStore.getState().jobs).toEqual({});
  });
});
