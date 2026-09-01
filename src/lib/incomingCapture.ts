import { slugifyTitle } from "../ai/clipArticle";
import { mergeFrontmatter, setNoteTags } from "./noteFrontmatter";
import {
  createNote,
  ensureFolder,
  INCOMING_FOLDER,
  joinPath,
  readNote,
  writeNote,
} from "./vaultApi";

export type CaptureToIncomingOpts = {
  body: string;
  quote?: string;
  sourcePath?: string;
  now?: Date;
};

export type BuildCaptureMarkdownOpts = CaptureToIncomingOpts;

/** Local date/time stamp for capture filenames: `2026-09-01 16-18`. */
export function formatCaptureFilenameStamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}-${min}`;
}

function slugFromBody(body: string, max = 40): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const slug = slugifyTitle(trimmed.slice(0, max));
  return slug ? ` — ${slug}` : "";
}

/** Vault-relative path under `Incoming/` for a new capture note. */
export function buildCapturePath(body: string, now: Date = new Date()): string {
  const stamp = formatCaptureFilenameStamp(now);
  const slug = slugFromBody(body);
  return joinPath(INCOMING_FOLDER, `${stamp}${slug}.md`);
}

function quoteBlock(quote: string): string {
  const lines = quote.replace(/\r\n/g, "\n").split("\n");
  return lines.map((line) => `> ${line}`).join("\n");
}

function wikiStem(path: string): string {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return name.replace(/\.md$/i, "");
}

/** On-disk markdown for a fleeting capture note. */
export function buildCaptureMarkdown(opts: BuildCaptureMarkdownOpts): string {
  const now = opts.now ?? new Date();
  const body = opts.body.trim();
  const quote = opts.quote?.trim() ?? "";
  const sourcePath = opts.sourcePath?.trim() ?? "";

  const parts: string[] = [];
  if (body) parts.push(body);
  if (quote) {
    if (parts.length > 0) parts.push("");
    parts.push(quoteBlock(quote));
  }
  if (sourcePath) {
    if (parts.length > 0) parts.push("");
    parts.push(`from [[${wikiStem(sourcePath)}]]`);
  }

  const markdownBody = parts.length > 0 ? `${parts.join("\n")}\n` : "\n";

  const data: Record<string, unknown> = {
    captured: now.toISOString(),
  };
  if (sourcePath) data.source = sourcePath;

  let md = mergeFrontmatter(data, markdownBody);
  md = setNoteTags(md, ["inbox"]);
  return md;
}

async function resolveUniqueCapturePath(
  body: string,
  now: Date,
): Promise<string> {
  const base = buildCapturePath(body, now);
  for (let n = 0; n < 50; n++) {
    const candidate =
      n === 0
        ? base
        : joinPath(
            INCOMING_FOLDER,
            `${formatCaptureFilenameStamp(now)}-${n + 1}.md`,
          );
    try {
      await readNote(candidate);
    } catch {
      return candidate;
    }
  }
  return joinPath(
    INCOMING_FOLDER,
    `${formatCaptureFilenameStamp(now)}-${Date.now()}.md`,
  );
}

/** Create a new capture note in `Incoming/` and return its vault path. */
export async function captureToIncoming(
  opts: CaptureToIncomingOpts,
): Promise<string> {
  const body = opts.body.trim();
  const quote = opts.quote?.trim() ?? "";
  if (!body && !quote) {
    throw new Error("Capture note cannot be empty");
  }

  const now = opts.now ?? new Date();
  await ensureFolder(INCOMING_FOLDER);
  const path = await resolveUniqueCapturePath(body || quote, now);
  await createNote(path);
  const markdown = buildCaptureMarkdown({ ...opts, now });
  await writeNote(path, markdown);
  return path;
}
