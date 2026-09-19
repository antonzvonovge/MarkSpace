import { describe, expect, it } from "vitest";
import { msUntilNextLocalMidnight } from "./useLocalToday";

describe("msUntilNextLocalMidnight", () => {
  it("returns time until next local midnight", () => {
    const now = new Date(2026, 8, 19, 14, 30, 0, 0);
    const nextMidnight = new Date(2026, 8, 20, 0, 0, 0, 0);
    expect(msUntilNextLocalMidnight(now)).toBe(
      nextMidnight.getTime() - now.getTime(),
    );
  });

  it("returns at least 1ms at exactly midnight", () => {
    const midnight = new Date(2026, 8, 19, 0, 0, 0, 0);
    expect(msUntilNextLocalMidnight(midnight)).toBeGreaterThanOrEqual(1);
  });
});
