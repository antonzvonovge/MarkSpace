const STORAGE_KEY = "markspace-incoming-ui-v1";

type IncomingUiState = {
  listMode: boolean;
};

const DEFAULT: IncomingUiState = {
  listMode: false,
};

function readStore(): IncomingUiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<IncomingUiState>;
    return {
      listMode: parsed.listMode === true,
    };
  } catch {
    return { ...DEFAULT };
  }
}

function writeStore(state: IncomingUiState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function loadIncomingListMode(): boolean {
  return readStore().listMode;
}

export function saveIncomingListMode(listMode: boolean): void {
  writeStore({ listMode });
}

/** Bump when captures change so list views can invalidate caches. */
let captureRevision = 0;
const revisionListeners = new Set<() => void>();

export function subscribeIncomingCaptureRevision(listener: () => void): () => void {
  revisionListeners.add(listener);
  return () => {
    revisionListeners.delete(listener);
  };
}

export function bumpIncomingCaptureRevision(): void {
  captureRevision += 1;
  for (const listener of revisionListeners) listener();
}

export function getIncomingCaptureRevision(): number {
  return captureRevision;
}
