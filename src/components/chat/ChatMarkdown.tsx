import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  text: string;
  className?: string;
  /** Trailing caret while streaming */
  caret?: boolean;
};

export function ChatMarkdown({ text, className, caret }: Props) {
  return (
    <div className={["chat-md", className].filter(Boolean).join(" ")}>
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
