import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { DiagramEngine } from "../../editor/diagramCache";
import {
  diagramEngineForLang,
  diagramRenderFn,
} from "../../editor/renderDiagram";
import { scheduleDiagramPreview } from "../../editor/scheduleDiagramPreview";
import { usePrefsStore } from "../../store/prefsStore";
import { DiagramLightbox, fitSvgInto } from "../DiagramLightbox";

export { diagramEngineForLang };

type Props = {
  engine: DiagramEngine;
  code: string;
};

export function ChatDiagram({ engine, code }: Props) {
  const theme = usePrefsStore((s) => s.prefs.theme);
  const dark = theme === "dark";
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return scheduleDiagramPreview({
      engine,
      code,
      dark,
      skin: "neutral",
      render: diagramRenderFn(engine),
      onUpdate: ({ svg, error: nextError, pending: nextPending }) => {
        setError(nextError);
        setPending(nextPending);
        if (containerRef.current) {
          fitSvgInto(containerRef.current, svg);
        }
      },
    });
  }, [engine, code, dark]);

  const openLightbox = useCallback(() => {
    if (!code.trim() || error) return;
    setOpen(true);
  }, [code, error]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLightbox();
    }
  };

  const onClick = (e: ReactMouseEvent) => {
    e.preventDefault();
    openLightbox();
  };

  if (!code.trim()) {
    return (
      <div className="chat-md-diagram">
        <div className="chat-md-diagram__empty">Empty diagram</div>
      </div>
    );
  }

  return (
    <>
      <div
        className="chat-md-diagram is-interactive"
        data-engine={engine}
        role="button"
        tabIndex={0}
        aria-label="Open diagram fullscreen"
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {pending ? (
          <div className="chat-md-diagram__pending">Rendering…</div>
        ) : null}
        {error ? <div className="chat-md-diagram__error">{error}</div> : null}
        <div
          ref={containerRef}
          className="chat-md-diagram__svg"
          hidden={Boolean(error)}
        />
      </div>
      <DiagramLightbox
        open={open}
        engine={engine}
        code={code}
        title={
          engine === "d2"
            ? "D2"
            : engine === "dot"
              ? "DOT"
              : engine === "markmap"
                ? "Markmap"
                : engine === "plantuml"
                  ? "PlantUML"
                  : "Mermaid"
        }
        onClose={() => setOpen(false)}
      />
    </>
  );
}
