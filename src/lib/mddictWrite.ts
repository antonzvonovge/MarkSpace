import {
  mergeDictItem,
  parseMddict,
  serializeMddict,
  type MddictItem,
} from "./mddictFormat";
import { readNote, writeNote } from "./vaultApi";
import { useVaultStore } from "../store/vaultStore";

function assertMddictPath(path: string): string {
  const p = path.trim();
  if (!p.toLowerCase().endsWith(".mddict")) {
    throw new Error(`Expected a .mddict path, got: ${path}`);
  }
  return p;
}

function readOpenDictBuffer(path: string): string | null {
  const state = useVaultStore.getState();
  if (state.activePath === path && state.content != null) return state.content;
  const tab = state.tabs.find((t) => t.path === path);
  if (tab?.body != null) return tab.body;
  return null;
}

export type AppendDictEntryResult = {
  path: string;
  merged: boolean;
  count: number;
};

/** Append or update an entry in a `.mddict` file and sync any open tab. */
export async function appendOrMergeDictEntry(
  path: string,
  item: MddictItem,
): Promise<AppendDictEntryResult> {
  const p = assertMddictPath(path);
  if (!item.word.trim()) {
    throw new Error("Word is required");
  }
  const raw = readOpenDictBuffer(p) ?? (await readNote(p));
  const { doc, merged } = mergeDictItem(parseMddict(raw), item);
  const text = serializeMddict(doc);
  const store = useVaultStore.getState();
  store.markExternalWrite();
  await writeNote(p, text);
  store.applyExternalContent(p, text, { force: true });
  void store.refreshDictionaryTags();
  return { path: p, merged, count: doc.items.length };
}
