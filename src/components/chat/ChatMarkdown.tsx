import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { FcDocument } from "react-icons/fc";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { highlightCodeToHtml } from "../../lib/codeHighlight";
import { writeClipboardText } from "../../lib/clipboardText";
import { normalizeDisplayMath } from "../../lib/mathMarkdown";
import { ensureFolderNote, folderPathFromFolderNote, resolveWikiTarget } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import { ChatDiagram, diagramEngineForLang } from "./ChatDiagram";


type Props = {
  text: string;
  className?: string;
  /** Trailing caret while streaming */
  caret?: boolean;
  /**
   * While streaming, render plain text instead of full markdown parse.
   * Avoids main-thread freezes from remark/GFM on every token.
   */
  streaming?: boolean;
};

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

/** Both `[[target]]` and `![[target]]`, with an optional `|label`. `#` is allowed in paths. */
const CHAT_NOTE_LINK_RE = /!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const CHAT_NOTE_SCHEME = "markspace-note:";

function noteLinkNodes(value: string): MarkdownNode[] | null {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(CHAT_NOTE_LINK_RE)) {
    const path = match[1].trim();
    if (!path) continue;

    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, index) });
    }
    const label = (match[2] ?? path).trim() || path;
    nodes.push({
      type: "link",
      url: `${CHAT_NOTE_SCHEME}${encodeURIComponent(path)}`,
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

/** Turn chat-only [[note]] / ![[path/note.md]] references into clickable links. */
function remarkChatNoteLinks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || node.type === "link" || node.type === "image") return;
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

function languageFromClassName(className: unknown): string | undefined {
  if (typeof className !== "string") return undefined;
  const match = /(?:^|\s)language-([^\s]+)/.exec(className);
  return match?.[1];
}

function codeText(children: ReactNode): string {
  return String(children ?? "").replace(/\n$/, "");
}

function ChatCodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      className={
        copied ? "code-block-copy-btn is-copied" : "code-block-copy-btn"
      }
      aria-label={copied ? "Copied" : "Copy code"}
      title={copied ? "Copied" : "Copy code"}
      onClick={() => {
        if (!code) return;
        void writeClipboardText(code).then(() => setCopied(true));
      }}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6.5 11.2L3.3 8l1.06-1.06L6.5 9.08l5.14-5.14L12.7 5 6.5 11.2z"
          />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M5.5 2A1.5 1.5 0 004 3.5V4h-.5A1.5 1.5 0 002 5.5v7A1.5 1.5 0 003.5 14h6a1.5 1.5 0 001.5-1.5V12h.5A1.5 1.5 0 0013 10.5v-7A1.5 1.5 0 0011.5 2h-6zM5 3.5a.5.5 0 01.5-.5h6a.5.5 0 01.5.5v7a.5.5 0 01-.5.5H11V5.5A1.5 1.5 0 009.5 4H5v-.5zM3.5 5H9.5a.5.5 0 01.5.5v7a.5.5 0 01-.5.5h-6a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5z"
          />
        </svg>
      )}
    </button>
  );
}

function ChatHighlightedPre({
  lang,
  code,
}: {
  lang: string | undefined;
  code: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void highlightCodeToHtml(code, lang).then((next) => {
      if (!cancelled) setHtml(next);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  return (
    <div className="chat-md-code">
      {lang ? <span className="chat-md-code__lang">{lang}</span> : null}
      <ChatCodeCopyButton code={code} />
      {html ? (
        <div
          className="chat-md-code__body"
          // Shiki returns a trusted <pre class="shiki"> tree from our own highlighter.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="chat-md-code__body is-pending">
          <code className={lang ? `language-${lang}` : undefined}>{code}</code>
        </pre>
      )}
    </div>
  );
}

function ChatPre({ children }: { children?: ReactNode }) {
  const only = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(only)) {
    return <pre>{children}</pre>;
  }

  const lang = languageFromClassName(only.props.className);
  const code = codeText(only.props.children);
  const engine = diagramEngineForLang(lang);
  if (engine) {
    return <ChatDiagram engine={engine} code={code} />;
  }

  return <ChatHighlightedPre lang={lang} code={code} />;
}

function ChatNoteLink({
  path,
  href,
  children,
}: {
  path: string;
  href: string;
  children: ReactNode;
}) {
  const openNote = useVaultStore((state) => state.openNote);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void resolveWikiTarget(path).then((resolved) => {
      if (!cancelled) setBroken(!resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <a
      className={broken ? "chat-note-link ms-broken-link" : "chat-note-link"}
      href={href}
      title={path}
      onClick={(event) => {
        event.preventDefault();
        const openPinned = event.ctrlKey || event.metaKey;
        const go = (notePath: string) =>
          openPinned
            ? openNote(notePath, { preview: false })
            : openNote(notePath);
        void (async () => {
          const resolved = await resolveWikiTarget(path);
          if (resolved) {
            const folder = folderPathFromFolderNote(resolved);
            const notePath = folder
              ? await ensureFolderNote(folder)
              : resolved;
            await go(notePath);
            return;
          }
          const folder = folderPathFromFolderNote(path);
          if (folder) {
            await go(await ensureFolderNote(folder));
            return;
          }
          await go(path);
        })();
      }}
    >
      <FcDocument aria-hidden="true" focusable="false" size={14} />
      <span>{children}</span>
    </a>
  );
}

function ChatMarkdownInner({ text, className, caret, streaming }: Props) {
  const rootClass = ["chat-md", className].filter(Boolean).join(" ");

  if (streaming) {
    return (
      <div className={`${rootClass} is-streaming-plain`}>
        <div className="chat-md-plain">{text}</div>
        {caret ? <span className="chat-caret" aria-hidden="true" /> : null}
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkChatNoteLinks]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) =>
          url.startsWith(CHAT_NOTE_SCHEME) ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith(CHAT_NOTE_SCHEME)) {
              const encodedPath = href.slice(CHAT_NOTE_SCHEME.length);
              let path: string;
              try {
                path = decodeURIComponent(encodedPath);
              } catch {
                return <span>{children}</span>;
              }
              return (
                <ChatNoteLink path={path} href={href}>
                  {children}
                </ChatNoteLink>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          // Avoid huge nested margins from default browser styles
          p: ({ children }) => <p>{children}</p>,
          pre: ({ children }) => <ChatPre>{children}</ChatPre>,
        }}
      >
        {normalizeDisplayMath(text)}
      </ReactMarkdown>
      {caret ? <span className="chat-caret" aria-hidden="true" /> : null}
    </div>
  );
}

export const ChatMarkdown = memo(ChatMarkdownInner);
