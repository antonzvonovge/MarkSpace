import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { DiagramEngine } from "../../editor/diagramCache";
import { renderMermaidToSvg } from "../../editor/mermaid/renderMermaid";
import { renderPlantUmlToSvg } from "../../editor/plantuml/renderPlantUml";
import { scheduleDiagramPreview } from "../../editor/scheduleDiagramPreview";
import { usePrefsStore } from "../../store/prefsStore";
import { DiagramLightbox, fitSvgInto } from "../DiagramLightbox";

const DIAGRAM_LANGS: Record<string, DiagramEngine> = {
  mermaid: "mermaid",
  plantuml: "plantuml",
  puml: "plantuml",
};

export function diagramEngineForLang(
  lang: string | undefined,
): DiagramEngine | null {
  if (!lang) return null;
  return DIAGRAM_LANGS[lang.toLowerCase()] ?? null;
}

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
      render: engine === "mermaid" ? renderMermaidToSvg : renderPlantUmlToSvg,
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
        onClose={() => setOpen(false)}
      />
    </>
  );
}
