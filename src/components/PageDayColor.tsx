import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayColorPicker } from "./DayColorPicker";
import {
  diaryProjectRootForPath,
  parseDailyNoteDate,
} from "../lib/diaryNotes";
import { getNoteDayColor, setNoteDayColor } from "../lib/noteFrontmatter";
import { PROJECT_COLOR_SWATCHES } from "../lib/projectColors";
import { useVaultStore } from "../store/vaultStore";

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
};

function swatchLabel(hex: string): string {
  return PROJECT_COLOR_SWATCHES.find((s) => s.hex === hex)?.label ?? "Day color";
}

export function PageDayColor({ path, content, onChange }: Props) {
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const rememberDiaryDayMarker = useVaultStore(
    (s) => s.rememberDiaryDayMarker,
  );
  const isDaily = useMemo(() => {
    if (!parseDailyNoteDate(path)) return false;
    return diaryProjectRootForPath(path, projectPropertiesByPath) != null;
  }, [path, projectPropertiesByPath]);

  const color = useMemo(() => getNoteDayColor(content), [content]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tintHostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clearTint = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.removeProperty("--day-page-color");
      el.classList.remove("has-day-color");
    };

    const clearHost = (host: HTMLElement | null) => {
      if (!host) return;
      clearTint(host);
      const main = host.closest(".editor-main") as HTMLElement | null;
      clearTint(main);
      if (host.classList.contains("editor-canvas")) {
        const wrap = host.parentElement as HTMLElement | null;
        if (wrap?.classList.contains("editor-canvas-wrap")) clearTint(wrap);
      }
    };

    const host = rootRef.current?.closest(
      ".editor-canvas, .source-editor-wrap",
    ) as HTMLElement | null;
    if (host) tintHostRef.current = host;

    const target = host ?? tintHostRef.current;
    if (!isDaily || !color) {
      clearHost(target);
      return () => clearHost(target);
    }

    target?.style.setProperty("--day-page-color", color);
    target?.classList.add("has-day-color");
    const main = target?.closest(".editor-main") as HTMLElement | null;
    if (main) {
      main.style.setProperty("--day-page-color", color);
      main.classList.add("has-day-color");
    }
    if (target?.classList.contains("editor-canvas")) {
      const wrap = target.parentElement as HTMLElement | null;
      if (wrap?.classList.contains("editor-canvas-wrap")) {
        wrap.style.setProperty("--day-page-color", color);
        wrap.classList.add("has-day-color");
      }
    }
    return () => clearHost(target);
  }, [isDaily, color]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 232;
    const height = 160;
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - width - 8),
    );
    const below = rect.bottom + 6;
    const top =
      below + height > window.innerHeight - 8
        ? Math.max(8, rect.top - height - 6)
        : below;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const t = event.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!isDaily) return null;

  const apply = (hex: string) => {
    const next = setNoteDayColor(content, hex);
    onChange(next);
    rememberDiaryDayMarker(path, next);
    setOpen(false);
  };

  const label = color ? `Day color: ${swatchLabel(color)}` : "Day color";

  return (
    <div className="page-day-color" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={
          color ? "page-day-color-btn is-set" : "page-day-color-btn"
        }
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="page-day-color-dot"
          aria-hidden
          style={color ? { background: color } : undefined}
        />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="day-marker-popover"
              role="dialog"
              aria-label="Day color"
              style={{ left: pos.left, top: pos.top }}
            >
              <DayColorPicker value={color} onChange={apply} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
