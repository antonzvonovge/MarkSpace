import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayMarkerPicker } from "./DayMarkerPicker";
import { dayMarkerById } from "../lib/dayMarkers";
import {
  diaryProjectRootForPath,
  parseDailyNoteDate,
} from "../lib/diaryNotes";
import { getNoteDayMarker, setNoteDayMarker } from "../lib/noteFrontmatter";
import { useDiarySettingsStore } from "../store/diarySettingsStore";
import { useVaultStore } from "../store/vaultStore";

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
};

export function PageDayMarker({ path, content, onChange }: Props) {
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const rememberDiaryDayMarker = useVaultStore(
    (s) => s.rememberDiaryDayMarker,
  );
  const markerCatalog = useDiarySettingsStore((s) => s.markers);
  const isDaily = useMemo(() => {
    if (!parseDailyNoteDate(path)) return false;
    return diaryProjectRootForPath(path, projectPropertiesByPath) != null;
  }, [path, projectPropertiesByPath]);

  const markerId = useMemo(() => getNoteDayMarker(content), [content]);
  const marker = markerId ? dayMarkerById(markerId, markerCatalog) : undefined;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 232;
    const height = 128;
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

  const apply = (id: string) => {
    const next = setNoteDayMarker(content, id);
    onChange(next);
    rememberDiaryDayMarker(path, next);
    setOpen(false);
  };

  const label = marker ? `Day marker: ${marker.label}` : "Day marker";

  return (
    <div className="page-day-marker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={
          marker
            ? "page-day-marker-btn is-set"
            : "page-day-marker-btn"
        }
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>{marker ? marker.emoji : "☆"}</span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="day-marker-popover"
              role="dialog"
              aria-label="Day marker"
              style={{ left: pos.left, top: pos.top }}
            >
              <DayMarkerPicker value={markerId} onChange={apply} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
