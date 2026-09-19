import { useEffect, useState } from "react";
import { dayKey, startOfLocalDay } from "../lib/diaryNotes";

/** Milliseconds until the next local calendar midnight (at least 1). */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  return Math.max(1, next.getTime() - now.getTime());
}

/**
 * Local calendar "today" that advances at midnight and when the window
 * becomes visible/focused again (sleep past midnight, long-running app).
 */
export function useLocalToday(): Date {
  const [today, setToday] = useState(() => startOfLocalDay());

  useEffect(() => {
    let timeoutId = 0;

    const sync = () => {
      const next = startOfLocalDay();
      setToday((prev) => (dayKey(prev) === dayKey(next) ? prev : next));
    };

    const schedule = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        sync();
        schedule();
      }, msUntilNextLocalMidnight());
    };

    sync();
    schedule();

    const onResume = () => {
      if (document.visibilityState !== "visible") return;
      sync();
      schedule();
    };

    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, []);

  return today;
}
