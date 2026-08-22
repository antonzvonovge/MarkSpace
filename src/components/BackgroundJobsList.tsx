import { memo, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useBackgroundJobsStore,
  type BackgroundJob,
} from "../store/backgroundJobsStore";

/**
 * The status bar's background job chip, deliberately kept in its own component.
 *
 * Indexing and clipping push progress several times a second; subscribing to
 * the job map from `StatusBar` itself would re-render the clock, word count and
 * sync chip along with it.
 */

function SpinnerIcon() {
  return (
    <svg
      className="status-sync-icon is-spinning"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="22 10"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function jobTitle(job: BackgroundJob): string {
  const parts = [job.label];
  if (job.status === "running" || job.status === "done") {
    parts.push(`${job.progress}%`);
  }
  if (job.status === "paused") parts.push("paused");
  if (job.status === "error") parts.push("error");
  return parts.join(" · ");
}

function jobTooltip(job: BackgroundJob): string {
  return job.detail ? `${jobTitle(job)} · ${job.detail}` : jobTitle(job);
}

function jobItemClass(job: BackgroundJob): string {
  if (job.status === "error") return "status-bar-item is-conflict";
  if (job.status === "running") return "status-bar-item is-busy";
  return "status-bar-item";
}

function BackgroundJobChip({
  job,
  count,
  stacked,
  menuOpen,
  onToggleMenu,
}: {
  job: BackgroundJob;
  count: number;
  stacked: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  const label = (
    <>
      {job.status === "running" ? <SpinnerIcon /> : null}
      <span>
        {count > 1 ? `(${count}) ` : null}
        {jobTitle(job)}
      </span>
    </>
  );
  const className = `${jobItemClass(job)}${menuOpen ? " is-open" : ""}`.trim();
  const tooltip = stacked
    ? `${jobTooltip(job)} · ${count} background processes`
    : job.status === "error"
      ? `${jobTooltip(job)} (click to dismiss)`
      : jobTooltip(job);

  if (stacked) {
    return (
      <button
        type="button"
        className={className}
        title={tooltip}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={onToggleMenu}
      >
        {label}
      </button>
    );
  }

  if (job.status === "error") {
    return (
      <button
        type="button"
        className={className}
        title={tooltip}
        onClick={() => useBackgroundJobsStore.getState().removeJob(job.id)}
      >
        <span>{jobTitle(job)}</span>
      </button>
    );
  }

  return (
    <span className={className} title={tooltip}>
      {label}
    </span>
  );
}

function BackgroundJobMenuRow({ job }: { job: BackgroundJob }) {
  const title = jobTooltip(job);
  const body = (
    <>
      {job.status === "running" ? <SpinnerIcon /> : null}
      <span className="status-bar-jobs-menu-label">
        <span>{jobTitle(job)}</span>
        {job.detail ? (
          <span className="status-bar-jobs-menu-detail">{job.detail}</span>
        ) : null}
      </span>
    </>
  );

  if (job.status === "error") {
    return (
      <button
        type="button"
        role="menuitem"
        className="status-bar-jobs-menu-item is-conflict"
        title={`${title} (click to dismiss)`}
        onClick={() => useBackgroundJobsStore.getState().removeJob(job.id)}
      >
        {body}
      </button>
    );
  }

  return (
    <div className="status-bar-jobs-menu-item" role="menuitem" title={title}>
      {body}
    </div>
  );
}

/** FIFO by first sighting, so the chip does not jump between jobs. */
export function selectVisibleJobs(
  jobs: Record<string, BackgroundJob>,
): BackgroundJob[] {
  return Object.values(jobs).sort(
    (a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0),
  );
}

export const BackgroundJobsList = memo(function BackgroundJobsList() {
  // Shallow compare so an unrelated store write cannot re-render the chip:
  // untouched jobs keep their object identity through `upsertJob`.
  const jobs = useBackgroundJobsStore(
    useShallow((s) => selectVisibleJobs(s.jobs)),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const primaryJob = jobs[0];
  const stackedJobs = jobs.slice(1);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (stackedJobs.length === 0 && menuOpen) setMenuOpen(false);
  }, [stackedJobs.length, menuOpen]);

  return (
    <div className="status-bar-left" ref={rootRef}>
      {primaryJob ? (
        <BackgroundJobChip
          job={primaryJob}
          count={jobs.length}
          stacked={stackedJobs.length > 0}
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen((v) => !v)}
        />
      ) : null}
      {menuOpen && stackedJobs.length > 0 ? (
        <div className="status-bar-jobs-menu" role="menu">
          {stackedJobs.map((job) => (
            <BackgroundJobMenuRow key={job.id} job={job} />
          ))}
        </div>
      ) : null}
    </div>
  );
});
