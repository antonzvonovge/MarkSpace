const SCROLLBAR_INSET = 6;

export type HorizontalOverlayScrollbar = {
  sync: () => void;
  dispose: () => void;
};

function getHorizontalScrollMetrics(
  scrollEl: HTMLElement,
  trackEl: HTMLElement,
  inset = SCROLLBAR_INSET,
): {
  maxScroll: number;
  trackWidth: number;
  thumbWidth: number;
  maxThumbOffset: number;
} {
  const maxScroll = Math.max(scrollEl.scrollWidth - scrollEl.clientWidth, 0);
  const trackWidth = Math.max(trackEl.clientWidth - inset * 2, 0);
  const ratio =
    scrollEl.scrollWidth > 0 ? scrollEl.clientWidth / scrollEl.scrollWidth : 1;
  const thumbWidth =
    maxScroll > 0 ? Math.max(Math.round(ratio * trackWidth), 20) : 0;
  const maxThumbOffset = Math.max(trackWidth - thumbWidth, 0);
  return { maxScroll, trackWidth, thumbWidth, maxThumbOffset };
}

export function setupHorizontalOverlayScrollbar(opts: {
  wrapEl: HTMLElement;
  scrollEl: HTMLElement;
  trackEl: HTMLElement;
  thumbEl: HTMLElement;
  inset?: number;
}): HorizontalOverlayScrollbar {
  const { wrapEl, scrollEl, trackEl, thumbEl } = opts;
  const inset = opts.inset ?? SCROLLBAR_INSET;

  let dragStartX = 0;
  let dragStartScrollLeft = 0;
  let dragging = false;

  const sync = (): void => {
    const { maxScroll, thumbWidth, maxThumbOffset } = getHorizontalScrollMetrics(
      scrollEl,
      trackEl,
      inset,
    );
    const scrollable = maxScroll > 1;
    wrapEl.classList.toggle("is-scrollable", scrollable);

    if (!scrollable) {
      thumbEl.style.width = "0";
      thumbEl.style.transform = "translateX(0)";
      return;
    }

    const thumbOffset =
      maxScroll > 0 ? (scrollEl.scrollLeft / maxScroll) * maxThumbOffset : 0;
    thumbEl.style.width = `${thumbWidth}px`;
    thumbEl.style.transform = `translateX(${thumbOffset}px)`;
  };

  const scrollBy = (delta: number): void => {
    const { maxScroll } = getHorizontalScrollMetrics(scrollEl, trackEl, inset);
    if (maxScroll <= 0) return;
    scrollEl.scrollLeft = Math.min(
      maxScroll,
      Math.max(0, scrollEl.scrollLeft + delta),
    );
  };

  const scrollToThumbOffset = (thumbOffset: number): void => {
    const { maxScroll, maxThumbOffset } = getHorizontalScrollMetrics(
      scrollEl,
      trackEl,
      inset,
    );
    if (maxScroll <= 0 || maxThumbOffset <= 0) return;
    scrollEl.scrollLeft = (thumbOffset / maxThumbOffset) * maxScroll;
  };

  const stopDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    thumbEl.classList.remove("is-dragging");
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", stopDrag);
    document.removeEventListener("pointercancel", stopDrag);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const { maxScroll, maxThumbOffset } = getHorizontalScrollMetrics(
      scrollEl,
      trackEl,
      inset,
    );
    if (maxScroll <= 0 || maxThumbOffset <= 0) return;
    const dx = event.clientX - dragStartX;
    const scrollPerPx = maxScroll / maxThumbOffset;
    scrollEl.scrollLeft = Math.min(
      maxScroll,
      Math.max(0, dragStartScrollLeft + dx * scrollPerPx),
    );
  };

  const onThumbPointerDown = (event: PointerEvent): void => {
    if (!wrapEl.classList.contains("is-scrollable")) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    dragStartX = event.clientX;
    dragStartScrollLeft = scrollEl.scrollLeft;
    thumbEl.classList.add("is-dragging");
    try {
      thumbEl.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);
  };

  const onTrackPointerDown = (event: PointerEvent): void => {
    if (!wrapEl.classList.contains("is-scrollable")) return;
    if ((event.target as Element).closest(".chat-overlay-scrollbar-thumb")) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = trackEl.getBoundingClientRect();
    const trackInnerLeft = rect.left + inset;
    const trackInnerWidth = Math.max(rect.width - inset * 2, 1);
    const clickX = event.clientX - trackInnerLeft;
    const { thumbWidth, maxThumbOffset } = getHorizontalScrollMetrics(
      scrollEl,
      trackEl,
      inset,
    );
    const targetOffset = Math.min(
      maxThumbOffset,
      Math.max(0, clickX - thumbWidth / 2),
    );
    scrollToThumbOffset(targetOffset);
  };

  const onWheel = (event: WheelEvent): void => {
    const { maxScroll } = getHorizontalScrollMetrics(scrollEl, trackEl, inset);
    if (maxScroll <= 0) return;

    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    if (delta === 0) return;

    event.preventDefault();
    event.stopPropagation();
    scrollBy(delta);
  };

  scrollEl.addEventListener("scroll", sync, { passive: true });
  wrapEl.addEventListener("wheel", onWheel, { passive: false });
  trackEl.addEventListener("wheel", onWheel, { passive: false });
  scrollEl.addEventListener("wheel", onWheel, { passive: false });
  thumbEl.addEventListener("pointerdown", onThumbPointerDown);
  trackEl.addEventListener("pointerdown", onTrackPointerDown);

  const resizeObserver = new ResizeObserver(() => sync());
  resizeObserver.observe(scrollEl);

  sync();

  return {
    sync,
    dispose: (): void => {
      stopDrag();
      scrollEl.removeEventListener("scroll", sync);
      wrapEl.removeEventListener("wheel", onWheel);
      trackEl.removeEventListener("wheel", onWheel);
      scrollEl.removeEventListener("wheel", onWheel);
      thumbEl.removeEventListener("pointerdown", onThumbPointerDown);
      trackEl.removeEventListener("pointerdown", onTrackPointerDown);
      resizeObserver.disconnect();
    },
  };
}
