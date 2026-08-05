import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { FcDocument } from "react-icons/fc";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
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

/** Both `[[target]]` and `![[target]]`, with an optional `|label`. */
const CHAT_NOTE_LINK_RE = /!?\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;
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

function ChatPre({ children }: { children?: ReactNode }) {
  const only = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(only)) {
    return <pre>{children}</pre>;
  }

  const lang = languageFromClassName(only.props.className);
  const engine = diagramEngineForLang(lang);
  if (engine) {
    return <ChatDiagram engine={engine} code={codeText(only.props.children)} />;
  }

  return <pre>{children}</pre>;
}

function ChatMarkdownInner({ text, className, caret, streaming }: Props) {
  const openNote = useVaultStore((state) => state.openNote);
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
                <a
                  className="chat-note-link"
                  href={href}
                  title={path}
                  onClick={(event) => {
                    event.preventDefault();
                    void (async () => {
                      const resolved = await resolveWikiTarget(path);
                      if (resolved) {
                        const folder = folderPathFromFolderNote(resolved);
                        const notePath = folder
                          ? await ensureFolderNote(folder)
                          : resolved;
                        await openNote(notePath);
                        return;
                      }
                      // Exact vault-relative .md path from the model.
                      const folder = folderPathFromFolderNote(path);
                      if (folder) {
                        await openNote(await ensureFolderNote(folder));
                        return;
                      }
                      await openNote(path);
                    })();
                  }}
                >
                  <FcDocument aria-hidden="true" focusable="false" size={14} />
                  <span>{children}</span>
                </a>
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
        {text}
      </ReactMarkdown>
      {caret ? <span className="chat-caret" aria-hidden="true" /> : null}
    </div>
  );
}

export const ChatMarkdown = memo(ChatMarkdownInner);
