import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
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
