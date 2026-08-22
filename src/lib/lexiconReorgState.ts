import { readNote, writeNote } from "./vaultApi";

export const LEXICON_REORG_STATE_PATH = ".markspace/lexicon-reorg.json";
/** Run a structure review after this many new lemma notes in a project. */
export const LEXICON_REORG_EVERY = 8;

export type LexiconReorgProjectState = {
  newLemmas: number;
  reorgDue: boolean;
};

export type LexiconReorgStateFile = {
  version: 1;
  byProject: Record<string, LexiconReorgProjectState>;
};

export function emptyLexiconReorgState(): LexiconReorgStateFile {
  return { version: 1, byProject: {} };
}

export function normalizeProjectKey(projectPath: string): string {
  return projectPath.replace(/^\/+|\/+$/g, "");
}

export function bumpLexiconLemmaCreated(
  file: LexiconReorgStateFile,
  projectPath: string,
  every = LEXICON_REORG_EVERY,
): LexiconReorgStateFile {
  const key = normalizeProjectKey(projectPath);
  if (!key) return file;
  const prev = file.byProject[key] ?? { newLemmas: 0, reorgDue: false };
  const newLemmas = prev.newLemmas + 1;
  return {
    version: 1,
    byProject: {
      ...file.byProject,
      [key]: {
        newLemmas,
        reorgDue: prev.reorgDue || newLemmas >= every,
      },
    },
  };
}

export function markLexiconReorgStarted(
  file: LexiconReorgStateFile,
  projectPath: string,
): LexiconReorgStateFile {
  const key = normalizeProjectKey(projectPath);
  if (!key) return file;
  return {
    version: 1,
    byProject: {
      ...file.byProject,
      [key]: { newLemmas: 0, reorgDue: false },
    },
  };
}

export function projectsDueForLexiconReorg(
  file: LexiconReorgStateFile,
  every = LEXICON_REORG_EVERY,
): string[] {
  return Object.entries(file.byProject)
    .filter(
      ([, s]) => s.reorgDue || s.newLemmas >= every,
    )
    .map(([key]) => key);
}

function parseState(raw: unknown): LexiconReorgStateFile {
  if (!raw || typeof raw !== "object") return emptyLexiconReorgState();
  const o = raw as { version?: unknown; byProject?: unknown };
  if (o.version !== 1 || !o.byProject || typeof o.byProject !== "object") {
    return emptyLexiconReorgState();
  }
  const byProject: Record<string, LexiconReorgProjectState> = {};
  for (const [key, val] of Object.entries(o.byProject as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const rec = val as { newLemmas?: unknown; reorgDue?: unknown };
    const newLemmas =
      typeof rec.newLemmas === "number" && Number.isFinite(rec.newLemmas)
        ? Math.max(0, Math.floor(rec.newLemmas))
        : 0;
    byProject[key] = {
      newLemmas,
      reorgDue: Boolean(rec.reorgDue) || newLemmas >= LEXICON_REORG_EVERY,
    };
  }
  return { version: 1, byProject };
}

export async function loadLexiconReorgState(): Promise<LexiconReorgStateFile> {
  try {
    const raw = await readNote(LEXICON_REORG_STATE_PATH);
    return parseState(JSON.parse(raw) as unknown);
  } catch {
    return emptyLexiconReorgState();
  }
}

export async function saveLexiconReorgState(
  file: LexiconReorgStateFile,
): Promise<void> {
  await writeNote(
    LEXICON_REORG_STATE_PATH,
    `${JSON.stringify(file, null, 2)}\n`,
  );
}
