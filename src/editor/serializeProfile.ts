/**
 * Stage timings for the Live → markdown export.
 *
 * Off unless `localStorage["markspace.debug.serializeProfile"] === "1"`, and
 * compiled out of release builds entirely, so the hot path pays nothing.
 * Toggle it from the devtools console and type in a large note to see which
 * stage actually dominates.
 */

const FLAG_KEY = "markspace.debug.serializeProfile";
const VERIFY_KEY = "markspace.debug.serializeVerify";
const MARK_PREFIX = "markspace:serialize";

export type StageTimer = <R>(name: string, fn: () => R) => R;

/** Runs the stage without measuring it; also useful as a nested no-op timer. */
export const passthroughStage: StageTimer = (_name, fn) => fn();

function debugFlag(key: string): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function profilingEnabled(): boolean {
  return debugFlag(FLAG_KEY);
}

/**
 * Cross-check an incremental export against a whole-document one.
 *
 * Enable with `localStorage["markspace.debug.serializeVerify"] = "1"` and edit
 * around: any divergence between the segment cache and a plain full export
 * shows up in the console instead of silently in the note. Expensive by
 * design — it does the work the cache exists to avoid.
 */
export function verifyIncrementalSerialization(
  label: string,
  incremental: string,
  buildFull: () => string,
): void {
  if (!debugFlag(VERIFY_KEY)) return;
  const full = buildFull();
  if (full === incremental) return;
  console.error(
    `[serialize] incremental output diverged for ${label}`,
    { incremental, full },
  );
}

/**
 * Runs `body`, giving it a `stage` wrapper to label each phase.
 *
 * `label` distinguishes runs in the log, e.g. the note path plus whether the
 * run was incremental.
 */
export function withSerializeProfile<T>(
  label: string,
  body: (stage: StageTimer) => T,
): T {
  if (!profilingEnabled()) return body(passthroughStage);

  const timings: string[] = [];
  const startedAt = performance.now();
  const stage: StageTimer = (name, fn) => {
    const startMark = `${MARK_PREFIX}:${name}:start`;
    const endMark = `${MARK_PREFIX}:${name}:end`;
    const measure = `${MARK_PREFIX}:${name}`;
    performance.mark(startMark);
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      const elapsed = performance.now() - t0;
      performance.mark(endMark);
      try {
        performance.measure(measure, startMark, endMark);
      } catch {
        /* measure is a nicety for the devtools timeline, never load-bearing */
      }
      // Entries accumulate for the lifetime of the window otherwise.
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
      performance.clearMeasures(measure);
      timings.push(`${name} ${elapsed.toFixed(1)}ms`);
    }
  };

  try {
    return body(stage);
  } finally {
    const total = performance.now() - startedAt;
    console.info(
      `[serialize] ${label} · total ${total.toFixed(1)}ms · ${timings.join(" · ")}`,
    );
  }
}
