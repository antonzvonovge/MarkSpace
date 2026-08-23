import { useEffect, useRef, useState } from "react";

export function formatToolElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}`;
  return `${s}s`;
}

/** Elapsed time for a tool that started in this session; null if never seen running. */
export function useToolRunTimer(running: boolean): string | null {
  const startedAtRef = useRef<number | null>(null);
  const frozenMsRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  if (running) {
    if (frozenMsRef.current != null) {
      startedAtRef.current = Date.now();
      frozenMsRef.current = null;
    } else if (startedAtRef.current == null) {
      startedAtRef.current = Date.now();
    }
  } else if (startedAtRef.current != null && frozenMsRef.current == null) {
    frozenMsRef.current = Math.max(0, Date.now() - startedAtRef.current);
  }

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  if (startedAtRef.current == null) return null;
  const ms =
    frozenMsRef.current ?? Math.max(0, now - startedAtRef.current);
  return formatToolElapsed(ms);
}
