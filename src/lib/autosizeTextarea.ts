/** Grow a textarea to fit content; never show a scrollbar or resize grip. */
export function syncAutosizeTextarea(
  el: HTMLTextAreaElement | null,
  minPx?: number,
) {
  if (!el) return;
  el.style.height = "0px";
  el.style.overflowY = "hidden";
  const min =
    minPx ??
    (() => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      return Number.isFinite(lh) ? lh : 20;
    })();
  el.style.height = `${Math.max(el.scrollHeight, min)}px`;
}
