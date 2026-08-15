/** Same-round specialist DAG: dependents wait and receive predecessor summaries. */

export type SpecialistDepResult = {
  ok: boolean;
  kind: string;
  title: string;
  summary: string;
  changedPaths: string[];
  error?: string;
};

type Slot = {
  id: string;
  title: string;
  registered: boolean;
  dependsOn: string[];
  promise: Promise<SpecialistDepResult>;
  resolve: (result: SpecialistDepResult) => void;
};

type Wave = {
  slots: Map<string, Slot>;
  inFlight: number;
};

const wavesBySignal = new WeakMap<AbortSignal, Wave>();
let fallbackWave: Wave | null = null;

function newWave(): Wave {
  return { slots: new Map(), inFlight: 0 };
}

function getWave(signal?: AbortSignal): Wave {
  if (signal) {
    let wave = wavesBySignal.get(signal);
    if (!wave) {
      wave = newWave();
      wavesBySignal.set(signal, wave);
    }
    return wave;
  }
  if (!fallbackWave) fallbackWave = newWave();
  return fallbackWave;
}

function getOrCreateSlot(wave: Wave, id: string): Slot {
  let slot = wave.slots.get(id);
  if (!slot) {
    let resolve!: (result: SpecialistDepResult) => void;
    const promise = new Promise<SpecialistDepResult>((r) => {
      resolve = r;
    });
    slot = {
      id,
      title: id,
      registered: false,
      dependsOn: [],
      promise,
      resolve,
    };
    wave.slots.set(id, slot);
  }
  return slot;
}

function hasCycle(wave: Wave, startId: string): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const slot = wave.slots.get(id);
    for (const dep of slot?.dependsOn ?? []) {
      if (dfs(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return dfs(startId);
}

function abortError(message = "Specialist cancelled"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function waitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function finishSlot(wave: Wave, signal?: AbortSignal) {
  wave.inFlight = Math.max(0, wave.inFlight - 1);
  if (wave.inFlight === 0) {
    wave.slots.clear();
    if (!signal) fallbackWave = null;
  }
}

export type SpecialistWaveHandle = {
  id: string;
  depTitles: () => string[];
  waitForDeps: () => Promise<SpecialistDepResult[]>;
  release: (result: SpecialistDepResult) => void;
};

export function beginSpecialistWave(params: {
  id: string;
  title: string;
  dependsOn: string[];
  signal?: AbortSignal;
}): SpecialistWaveHandle {
  const id = params.id.trim();
  const title = params.title.trim() || id;
  const dependsOn = [
    ...new Set(params.dependsOn.map((d) => d.trim()).filter(Boolean)),
  ];
  const wave = getWave(params.signal);
  const existing = wave.slots.get(id);
  if (existing?.registered) {
    throw new Error(`Duplicate specialist id in this round: ${id}`);
  }

  wave.inFlight += 1;
  const slot = getOrCreateSlot(wave, id);
  slot.registered = true;
  slot.title = title;
  slot.dependsOn = dependsOn;

  let released = false;
  const release = (result: SpecialistDepResult) => {
    if (released) return;
    released = true;
    slot.resolve(result);
    finishSlot(wave, params.signal);
  };

  const depTitles = () =>
    dependsOn.map((depId) => wave.slots.get(depId)?.title || depId);

  const waitForDeps = async (): Promise<SpecialistDepResult[]> => {
    if (dependsOn.length === 0) return [];
    // Let sibling execute() calls register before we decide who is missing.
    await Promise.resolve();
    if (params.signal?.aborted) throw abortError();
    if (hasCycle(wave, id)) {
      throw new Error(`Cyclic specialist depends_on involving "${id}"`);
    }
    const missing = dependsOn.filter((depId) => {
      const dep = wave.slots.get(depId);
      return !dep?.registered;
    });
    if (missing.length) {
      throw new Error(
        `depends_on id not found in this round: ${missing.join(", ")}`,
      );
    }
    return Promise.all(
      dependsOn.map((depId) =>
        waitWithAbort(wave.slots.get(depId)!.promise, params.signal),
      ),
    );
  };

  return { id, depTitles, waitForDeps, release };
}

export function formatPredecessorContext(
  results: SpecialistDepResult[],
): string {
  if (results.length === 0) return "";
  const lines = [
    "Prior specialist results (use these; do not redo their work):",
  ];
  for (const r of results) {
    const paths =
      r.changedPaths.length > 0 ? r.changedPaths.join(", ") : "(none)";
    const err = r.error ? `; error: ${r.error}` : "";
    lines.push(
      `- "${r.title}" (${r.kind}): ok=${r.ok}; summary: ${r.summary}; changedPaths: ${paths}${err}`,
    );
  }
  return lines.join("\n");
}

export function withPredecessorContext(
  task: string,
  results: SpecialistDepResult[],
): string {
  const ctx = formatPredecessorContext(results);
  const body = task.trim();
  if (!ctx) return body;
  return `${ctx}\n\n${body}`;
}

export function waitingStatusForDeps(titles: string[]): string {
  if (titles.length === 0) return "Waiting…";
  if (titles.length === 1) return `Waiting for ${titles[0]}…`;
  return `Waiting for ${titles.join(", ")}…`;
}

/** @internal test helper */
export function _resetSpecialistDepsForTests() {
  fallbackWave = null;
}
