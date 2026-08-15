import { flushDrawioEditor } from "../editor/drawio/drawioEditorFlush";
import { flushLiveEditor } from "../editor/liveEditorFlush";
import { readNote } from "../lib/vaultApi";
import { dirtyNoteBuffer } from "../store/vaultStore";

/**
 * Read a note as the user currently sees it rather than as it last landed on
 * disk.
 *
 * An open note can hold seconds of unsaved keystrokes: the Live→markdown export
 * is debounced, and the disk write is debounced again on top of that. Reading
 * straight from disk made the agent reason about stale text, and made the
 * read-modify-write in `edit_note` write that stale text back, dropping
 * everything the user had typed since the last save.
 */
export async function readNoteBuffer(path: string): Promise<string> {
  flushLiveEditor(path);
  flushDrawioEditor(path);
  return dirtyNoteBuffer(path) ?? (await readNote(path));
}
