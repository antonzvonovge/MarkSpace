import { memo, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { RefreshIcon } from "../../components/treeIcons";
import {
  isAbsoluteFsPath,
  readExternalText,
  readNote,
} from "../../lib/vaultApi";
import { useDashboardsLive } from "../../store/dashboardEnabledStore";
import { DashboardMarkdown } from "./DashboardMarkdown";
import { WidgetNoteIcon } from "./widgetIcons";

const REFRESH_MS = 15 * 60 * 1000;

type Body =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "ready"; text: string }
  | { phase: "error"; message: string };

function noteTitle(path: string): string {
  const name = path.split(/[/\\]/).pop()?.trim();
  return name || "Note";
}

function isMissingFile(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found/i.test(message);
}

async function browseMarkdownFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    title: "Choose a markdown file",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  return typeof selected === "string" && selected ? selected : null;
}

export const NoteWidget = memo(function NoteWidget({
  path,
  onRemove,
  onPath,
}: {
  path: string;
  onRemove: () => void;
  onPath: (path: string) => void;
}) {
  const configured = path.length > 0;
  const live = useDashboardsLive();
  const [reload, setReload] = useState(0);
  const [body, setBody] = useState<Body>({ phase: "idle" });
  const shownPath = useRef("");

  useEffect(() => {
    if (!live || !configured) return;
    let cancelled = false;
    if (shownPath.current !== path) {
      shownPath.current = "";
      setBody({ phase: "loading" });
    }
    const load = () => {
      const read = isAbsoluteFsPath(path) ? readExternalText(path) : readNote(path);
      void read
        .then((text) => {
          if (cancelled) return;
          shownPath.current = path;
          setBody({ phase: "ready", text });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (isMissingFile(err)) {
            shownPath.current = path;
            setBody({ phase: "missing" });
            return;
          }
          setBody((current) =>
            current.phase === "ready"
              ? current
              : {
                  phase: "error",
                  message: err instanceof Error ? err.message : String(err),
                },
          );
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live, configured, path, reload]);

  const browse = () => {
    void browseMarkdownFile().then((selected) => {
      if (selected) onPath(selected);
    });
  };

  return (
    <article className="dashboard-widget">
      <header className="dashboard-widget-handle">
        <span className="dashboard-widget-kind">
          <WidgetNoteIcon />
        </span>
        <span className="dashboard-widget-title">{configured ? noteTitle(path) : "Note"}</span>
        {configured ? (
          <button
            type="button"
            className="dashboard-widget-refresh"
            aria-label="Refresh"
            title={live ? "Refresh" : "Dashboards are off"}
            disabled={!live}
            onClick={(event) => {
              event.stopPropagation();
              if (!live) return;
              setReload((value) => value + 1);
            }}
          >
            <RefreshIcon />
          </button>
        ) : null}
        <button
          type="button"
          className="dashboard-widget-browse"
          onClick={(event) => {
            event.stopPropagation();
            browse();
          }}
        >
          Browse
        </button>
        <button
          type="button"
          className="dashboard-widget-remove"
          aria-label="Remove widget"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </header>
      <div className="dashboard-widget-body">
        {!configured ? (
          <p className="dashboard-widget-empty">Choose a markdown file.</p>
        ) : !live ? (
          <p className="dashboard-widget-empty">Paused</p>
        ) : body.phase === "loading" || body.phase === "idle" ? (
          <p className="dashboard-widget-empty">Loading…</p>
        ) : body.phase === "missing" ? (
          <p className="dashboard-widget-empty">File not found</p>
        ) : body.phase === "error" ? (
          <p className="dashboard-widget-empty">{body.message}</p>
        ) : body.text.trim() ? (
          <DashboardMarkdown text={body.text} sourcePath={path} />
        ) : (
          <p className="dashboard-widget-empty">This note is empty</p>
        )}
      </div>
    </article>
  );
});
