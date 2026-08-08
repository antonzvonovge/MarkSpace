/** Practice progress for dictionary entries (sidecar under `.markspace/dict-progress/`). */

import { invoke } from "@tauri-apps/api/core";
import {
  parseMddict,
  serializeMddict,
  type MddictItem,
} from "./mddictFormat";
import { readNote, writeNote } from "./vaultApi";
import { useVaultStore } from "../store/vaultStore";

export const DICT_KNOWN_THRESHOLD = 7;

export type DictEntryProgress = {
  correctCount: number;
};

export type DictProgressDoc = {
  projectPath: string;
  /** dictPath → word → progress */
  entries: Record<string, Record<string, DictEntryProgress>>;
};

export async function getDictProgress(
  projectPath: string,
): Promise<DictProgressDoc> {
  const raw = await invoke<DictProgressDoc>("get_dict_progress", {
    projectPath,
  });
  return {
    projectPath: raw.projectPath ?? projectPath,
    entries: raw.entries ?? {},
  };
}

export async function setDictEntryCorrectCount(
  projectPath: string,
  dictPath: string,
  word: string,
  correctCount: number,
): Promise<DictEntryProgress> {
  return invoke<DictEntryProgress>("set_dict_entry_progress", {
    projectPath,
    dictPath,
    word,
    correctCount: Math.max(0, Math.floor(correctCount)),
  });
}

export function correctCountFor(
  progress: DictProgressDoc | null | undefined,
  dictPath: string,
  word: string,
): number {
  if (!progress) return 0;
  const byDict = progress.entries[dictPath];
  if (!byDict) return 0;
  const target = word.trim().toLowerCase();
  for (const [w, entry] of Object.entries(byDict)) {
    if (w.trim().toLowerCase() === target) {
      return entry.correctCount ?? 0;
    }
  }
  return 0;
}

function syncOpenEditor(path: string, content: string) {
  window.setTimeout(() => {
    const latest = useVaultStore.getState();
    latest.applyExternalContent(path, content);
    if (latest.activePath === path || latest.tabs.some((t) => t.path === path)) {
      latest.markExternalWrite();
    }
  }, 0);
}

/** Update `known` on a dictionary entry and optionally sync open tabs. */
export async function setMddictItemKnown(
  dictPath: string,
  word: string,
  known: boolean,
): Promise<MddictItem | null> {
  const p = dictPath.trim();
  if (!p.toLowerCase().endsWith(".mddict")) {
    throw new Error(`Expected a .mddict path, got: ${dictPath}`);
  }
  const { activePath, content, tabs } = useVaultStore.getState();
  const openTab = tabs.find((t) => t.path === p);
  const raw =
    activePath === p && content != null
      ? content
      : openTab?.body != null
        ? openTab.body
        : await readNote(p);
  const doc = parseMddict(raw);
  const target = word.trim().toLowerCase();
  const idx = doc.items.findIndex(
    (item) => item.word.trim().toLowerCase() === target,
  );
  if (idx < 0) return null;
  const cur = doc.items[idx]!;
  if (cur.known === known) return cur;
  doc.items[idx] = { ...cur, known };
  const text = serializeMddict(doc);
  await writeNote(p, text);
  syncOpenEditor(p, text);
  void useVaultStore.getState().refreshDictionaryTags();
  return doc.items[idx]!;
}

/** Mark known in the `.mddict` and set progress to the threshold. */
export async function markDictEntryKnown(
  projectPath: string,
  dictPath: string,
  word: string,
): Promise<void> {
  await setMddictItemKnown(dictPath, word, true);
  await setDictEntryCorrectCount(
    projectPath,
    dictPath,
    word,
    DICT_KNOWN_THRESHOLD,
  );
}

/** Clear known in the `.mddict` and reset progress to 0. */
export async function markDictEntryUnknown(
  projectPath: string,
  dictPath: string,
  word: string,
): Promise<void> {
  await setMddictItemKnown(dictPath, word, false);
  await setDictEntryCorrectCount(projectPath, dictPath, word, 0);
}

/**
 * Increment correct count; when threshold is reached, set `known: yes` on the entry.
 * Returns the new count and whether known was just reached.
 */
export async function recordDictCorrectAnswer(
  projectPath: string,
  dictPath: string,
  word: string,
): Promise<{ correctCount: number; becameKnown: boolean }> {
  const progress = await getDictProgress(projectPath);
  const prev = correctCountFor(progress, dictPath, word);
  const next = Math.min(prev + 1, DICT_KNOWN_THRESHOLD);
  await setDictEntryCorrectCount(projectPath, dictPath, word, next);
  let becameKnown = false;
  if (next >= DICT_KNOWN_THRESHOLD) {
    const item = await setMddictItemKnown(dictPath, word, true);
    becameKnown = item?.known === true;
  }
  return { correctCount: next, becameKnown };
}
