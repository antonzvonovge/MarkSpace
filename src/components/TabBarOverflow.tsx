import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useHorizontalWheelScroll } from "../hooks/useHorizontalWheelScroll";

type Thumb = { widthPct: number; leftPct: number };

export function TabBarOverflow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const scrollerRef = useHorizontalWheelScroll<HTMLDivElement>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startScroll: number } | null>(
    null,
  );

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    if (scrollWidth <= clientWidth + 1) {
      setThumb(null);
      return;
    }
    setThumb({
      widthPct: (clientWidth / scrollWidth) * 100,
      leftPct: (scrollLeft / scrollWidth) * 100,
    });
  }, [scrollerRef]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const mo = new MutationObserver(() => {
      for (const child of el.children) {
        if (child instanceof Element) ro.observe(child);
      }
      sync();
    });
    for (const child of el.children) {
      if (child instanceof Element) ro.observe(child);
    }
    mo.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
      mo.disconnect();
    };
  }, [scrollerRef, sync]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap || !thumb) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const trackWidth = wrap.clientWidth;
    const clickRatio = event.nativeEvent.offsetX / trackWidth;
    const thumbStart = thumb.leftPct / 100;
    const thumbEnd = thumbStart + thumb.widthPct / 100;
    if (clickRatio < thumbStart || clickRatio > thumbEnd) {
      el.scrollLeft =
        (clickRatio - thumb.widthPct / 200) * el.scrollWidth;
    }
    dragRef.current = {
      startX: event.clientX,
      startScroll: el.scrollLeft,
    };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    const wrap = wrapRef.current;
    const drag = dragRef.current;
    if (!el || !wrap || !drag) return;
    const scale = el.scrollWidth / wrap.clientWidth;
    el.scrollLeft = drag.startScroll + (event.clientX - drag.startX) * scale;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={["editor-tabbar-wrap", dragging ? "is-dragging" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div ref={scrollerRef} className="editor-tabbar" role="tablist">
        {children}
      </div>
      {thumb ? (
        <div
          className="editor-tabbar-overlay"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            className="editor-tabbar-overlay-thumb"
            style={{
              width: `${thumb.widthPct}%`,
              left: `${thumb.leftPct}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
