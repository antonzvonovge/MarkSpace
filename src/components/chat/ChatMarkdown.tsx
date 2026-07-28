import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
        }}
      >
        {text}
      </ReactMarkdown>
      {caret ? <span className="chat-caret" aria-hidden="true" /> : null}
    </div>
  );
}

export const ChatMarkdown = memo(ChatMarkdownInner);
