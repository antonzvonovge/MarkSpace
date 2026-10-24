import { memo, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ensureFolderNote,
  folderPathFromFolderNote,
  resolveWikiTarget,
} from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import {
  classifyDashboardHref,
  DASHBOARD_NOTE_SCHEME,
} from "./resolveDashboardHref";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

/** Both `[[target]]` and `![[target]]`, with an optional `|label`. */
const WIKI_LINK_RE = /!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function noteLinkNodes(value: string): MarkdownNode[] | null {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(WIKI_LINK_RE)) {
    const path = match[1].trim();
    if (!path) continue;

    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, index) });
    }
    const label = (match[2] ?? path).trim() || path;
    nodes.push({
      type: "link",
      url: `${DASHBOARD_NOTE_SCHEME}${encodeURIComponent(path)}`,
      children: [{ type: "text", value: label }],
    });
    cursor = index + match[0].length;
  }

  if (nodes.length === 0) return null;
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes;
}

function remarkDashboardNoteLinks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || node.type === "link" || node.type === "image") {
        return;
      }
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (child.type === "text" && child.value) {
          const replacement = noteLinkNodes(child.value);
          if (replacement) {
            node.children.splice(index, 1, ...replacement);
            index += replacement.length - 1;
          }
        } else {
          visit(child);
        }
      }
    };
    visit(tree);
  };
}

const remarkPlugins = [remarkGfm, remarkDashboardNoteLinks];

function dashboardUrlTransform(url: string): string {
  if (url.startsWith(DASHBOARD_NOTE_SCHEME)) return url;
  if (/^file:/i.test(url)) return url;
  if (
    url.startsWith("/") ||
    url.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(url)
  ) {
    return url;
  }
  return defaultUrlTransform(url);
}

async function openFromHref(
  href: string,
  sourcePath: string,
  openPinned: boolean,
): Promise<void> {
  const classified = classifyDashboardHref(href, sourcePath);
  const openNote = useVaultStore.getState().openNote;
  const go = (path: string) =>
    openPinned
      ? openNote(path, { preview: false })
      : openNote(path, { replaceActive: true });

  if (classified.action === "none") return;
  if (classified.action === "browser") {
    await openUrl(classified.url);
    return;
  }
  if (classified.action === "open") {
    await go(classified.path);
    return;
  }

  let resolved = await resolveWikiTarget(classified.target);
  if (!resolved && classified.target.toLowerCase().endsWith(".md")) {
    resolved = await resolveWikiTarget(
      classified.target.replace(/\.md$/i, ""),
    );
  }
  if (!resolved) return;
  const folder = folderPathFromFolderNote(resolved);
  const notePath = folder ? await ensureFolderNote(folder) : resolved;
  await go(notePath);
}

export const DashboardMarkdown = memo(function DashboardMarkdown({
  text,
  sourcePath,
}: {
  text: string;
  /** Path of the markdown file being shown (absolute or vault-relative). */
  sourcePath: string;
}) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement | null)?.closest("a");
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    const openPinned = event.ctrlKey || event.metaKey;
    void openFromHref(href, sourcePath, openPinned);
  };

  return (
    <div className="dashboard-markdown" onClick={onClick}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        urlTransform={dashboardUrlTransform}
        components={{
          a: ({ href, children }: { href?: string; children?: ReactNode }) => (
            <a href={href ?? "#"}>{children}</a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
