import { BlockNoteEditor } from "@blocknote/core";
import { getLiveEditor } from "../editor/completedTasksCommand";
import { noteEditorSchema } from "../editor/schema";
import { editorMarkdownToHashtags } from "./hashtagMarkdown";
import { restoreImagePreviewWidthsFromAlt } from "./imageMarkdown";
import { mathToEditorMarkdown } from "./mathMarkdown";
import { markdownToNestedBlocks } from "./nestedListMarkdown";
import { normalizeMarkdown } from "./normalizeMarkdown";
import { noteBody } from "./noteFrontmatter";
import { writeFileBytes } from "./vaultApi";
import { wikiToMarkdown } from "./wikiMarkdown";
import { useBackgroundJobsStore } from "../store/backgroundJobsStore";
import { useVaultStore } from "../store/vaultStore";

const ERROR_HIDE_MS = 8_000;
const errorHideTimers = new Map<string, number>();

export function siblingDocxRel(mdRel: string): string {
  const rel = mdRel.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  const i = rel.lastIndexOf("/");
  const name = i >= 0 ? rel.slice(i + 1) : rel;
  const dir = i >= 0 ? rel.slice(0, i) : "";
  const stem = name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
  const file = `${stem}.docx`;
  return dir ? `${dir}/${file}` : file;
}

export function wrapNoteHtmlForDocx(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" /></head><body>${bodyHtml}</body></html>`;
}

function noteStem(path: string): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

function reportJob(
  jobId: string,
  patch: {
    label: string;
    progress: number;
    status: "running" | "error" | "done";
    detail?: string;
  },
) {
  const prev = errorHideTimers.get(jobId);
  if (prev != null) {
    window.clearTimeout(prev);
    errorHideTimers.delete(jobId);
  }
  useBackgroundJobsStore.getState().upsertJob({
    id: jobId,
    label: patch.label,
    progress: patch.progress,
    status: patch.status,
    detail: patch.detail,
  });
  if (patch.status === "error") {
    const timer = window.setTimeout(() => {
      errorHideTimers.delete(jobId);
      useBackgroundJobsStore.getState().removeJob(jobId);
    }, ERROR_HIDE_MS);
    errorHideTimers.set(jobId, timer);
  }
}

async function noteHtmlFromEditor(path: string, markdown: string): Promise<string> {
  const live = getLiveEditor(path);
  if (live) {
    return Promise.resolve(live.blocksToHTMLLossy(live.document));
  }
  const ed = BlockNoteEditor.create({ schema: noteEditorSchema });
  try {
    const body = noteBody(normalizeMarkdown(markdown));
    const blocks = restoreImagePreviewWidthsFromAlt(
      markdownToNestedBlocks(
        ed,
        mathToEditorMarkdown(editorMarkdownToHashtags(wikiToMarkdown(body))),
      ),
    );
    const resolved = await Promise.resolve(blocks);
    ed.replaceBlocks(ed.document, resolved as never);
    return Promise.resolve(ed.blocksToHTMLLossy(ed.document));
  } finally {
    ed._tiptapEditor.destroy();
  }
}

/** Save the open markdown note as a sibling .docx. Status bar shows progress. */
export function startSaveActiveNoteAsDocx(): void {
  const path = useVaultStore.getState().activePath?.trim() ?? "";
  if (!path) {
    reportJob("save-docx:active", {
      label: "Save as Word",
      progress: 0,
      status: "error",
      detail: "Open a markdown note first",
    });
    return;
  }
  if (!path.toLowerCase().endsWith(".md")) {
    reportJob("save-docx:active", {
      label: "Save as Word",
      progress: 0,
      status: "error",
      detail: "Only markdown notes can be saved as Word",
    });
    return;
  }
  const name = noteStem(path);
  const jobId = `save-docx:${path}`;
  void (async () => {
    reportJob(jobId, {
      label: `Saving ${name}.docx`,
      progress: 15,
      status: "running",
      detail: "Building Word document",
    });
    try {
      await useVaultStore.getState().saveActive();
      const markdown = useVaultStore.getState().content;
      const inner = await noteHtmlFromEditor(path, markdown);
      const html = wrapNoteHtmlForDocx(inner);
      const { htmlToDocxBytes } = await import("./htmlToDocx");
      const bytes = await htmlToDocxBytes(html);
      const dest = siblingDocxRel(path);
      const written = await writeFileBytes(dest, bytes, { overwrite: true });
      await useVaultStore.getState().refreshTree();
      reportJob(jobId, {
        label: `Saved ${name}.docx`,
        progress: 100,
        status: "done",
        detail: written,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reportJob(jobId, {
        label: `Save ${name}.docx`,
        progress: 0,
        status: "error",
        detail: msg || "Save as Word failed",
      });
    }
  })();
}
