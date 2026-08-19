import { useEffect, useLayoutEffect, useRef } from "react";
import {
  loadDocEditorScroll,
  saveDocEditorScroll,
  type EditorScrollPane,
} from "../lib/editorScrollState";
import { useVaultStore } from "../store/vaultStore";

const SAVE_DEBOUNCE_MS = 250;
const RESTORE_MAX_FRAMES = 90;

function scrollerIsLaidOut(el: HTMLElement): boolean {
  return el.clientHeight > 0 && el.clientWidth > 0;
}

function scrollerIsDisplayNone(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    if (getComputedStyle(node).display === "none") return true;
    node = node.parentElement;
  }
  return false;
}

function maxScrollTop(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

function applyScrollTop(el: HTMLElement, top: number): void {
  el.scrollTop = Math.min(Math.max(0, top), maxScrollTop(el));
}

function readableScrollTop(el: HTMLElement): number | null {
  if (!scrollerIsLaidOut(el) || scrollerIsDisplayNone(el)) return null;
  return el.scrollTop;
}

/**
 * Save / restore pixel scroll for a document scroller.
 *
 * `display: none` zeros `scrollTop`; ignore those events and restore when the
 * pane is shown again. `visibility: hidden` keeps native scroll — restore is
 * then a no-op if the position is already correct.
 */
export function usePersistedEditorScroll(
  scroller: HTMLElement | null,
  path: string,
  pane: EditorScrollPane,
  options?: { active?: boolean; skipRestore?: boolean },
): void {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const active = options?.active ?? true;
  const skipRestore = options?.skipRestore ?? false;
  const lastGoodRef = useRef(0);
  const restoringRef = useRef(false);
  const skippedRestoreRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const enabled = Boolean(path);

  useLayoutEffect(() => {
    if (!enabled) return;
    lastGoodRef.current = loadDocEditorScroll(vaultPath, path, pane);
    skippedRestoreRef.current = false;
  }, [enabled, vaultPath, path, pane]);

  useEffect(() => {
    if (!enabled || !scroller) return;

    const persist = (top: number, immediate: boolean) => {
      lastGoodRef.current = top;
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (immediate) {
        saveDocEditorScroll(vaultPath, path, pane, top);
        return;
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        saveDocEditorScroll(vaultPath, path, pane, top);
      }, SAVE_DEBOUNCE_MS);
    };

    const onScroll = () => {
      if (restoringRef.current) return;
      const top = readableScrollTop(scroller);
      if (top == null) return;
      persist(top, false);
    };

    const flush = () => {
      if (restoringRef.current) return;
      const top = readableScrollTop(scroller);
      persist(top ?? lastGoodRef.current, true);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, [enabled, scroller, vaultPath, path, pane]);

  useEffect(() => {
    if (!enabled || active) return;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveDocEditorScroll(vaultPath, path, pane, lastGoodRef.current);
  }, [enabled, active, vaultPath, path, pane]);

  useLayoutEffect(() => {
    if (!enabled || !scroller || !active) return;
    if (skipRestore) {
      skippedRestoreRef.current = true;
      return;
    }
    if (skippedRestoreRef.current) return;

    const saved = loadDocEditorScroll(vaultPath, path, pane);
    if (saved <= 0) return;

    let cancelled = false;
    let frames = 0;
    restoringRef.current = true;

    const tryRestore = () => {
      if (cancelled) return;
      if (skipRestore || skippedRestoreRef.current) {
        restoringRef.current = false;
        return;
      }
      if (
        scrollerIsLaidOut(scroller) &&
        !scrollerIsDisplayNone(scroller)
      ) {
        const max = maxScrollTop(scroller);
        if (max >= saved || frames >= 12) {
          applyScrollTop(scroller, saved);
          if (max >= saved || frames >= RESTORE_MAX_FRAMES) {
            lastGoodRef.current = scroller.scrollTop;
            restoringRef.current = false;
            return;
          }
        }
      }
      frames += 1;
      if (frames < RESTORE_MAX_FRAMES) {
        requestAnimationFrame(tryRestore);
        return;
      }
      restoringRef.current = false;
    };

    tryRestore();
    return () => {
      cancelled = true;
      restoringRef.current = false;
    };
  }, [enabled, scroller, active, skipRestore, vaultPath, path, pane]);
}
