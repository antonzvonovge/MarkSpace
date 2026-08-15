import { describe, expect, it } from "vitest";
import { groupChatHistory } from "./chatHistoryGroups";

/** Local noon on 15 Aug 2026 — matches the session date. */
const NOW = new Date(2026, 7, 15, 12, 0, 0).getTime();

function item(id: string, updatedAt: number) {
  return { id, updatedAt };
}

function at(year: number, month: number, day: number, hour = 10): number {
  return new Date(year, month, day, hour, 0, 0).getTime();
}

describe("groupChatHistory", () => {
  it("returns empty groups for no items", () => {
    expect(groupChatHistory([], NOW)).toEqual([]);
  });

  it("puts same-day chats in Today without a header", () => {
    const groups = groupChatHistory(
      [item("a", at(2026, 7, 15, 9)), item("b", at(2026, 7, 15, 18))],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "today", label: null });
    expect(groups[0].items.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("splits Today, Yesterday, Previous 7 days, Previous 30 days", () => {
    const groups = groupChatHistory(
      [
        item("today", at(2026, 7, 15, 8)),
        item("yesterday", at(2026, 7, 14, 20)),
        item("sixDays", at(2026, 7, 9, 11)),
        item("eightDays", at(2026, 7, 7, 11)),
      ],
      NOW,
    );
    expect(groups.map((g) => ({ id: g.id, label: g.label }))).toEqual([
      { id: "today", label: null },
      { id: "yesterday", label: "Yesterday" },
      { id: "previous7", label: "Previous 7 days" },
      { id: "previous30", label: "Previous 30 days" },
    ]);
    expect(groups.map((g) => g.items.map((t) => t.id))).toEqual([
      ["today"],
      ["yesterday"],
      ["sixDays"],
      ["eightDays"],
    ]);
  });

  it("groups older chats by month, current year without year suffix", () => {
    const groups = groupChatHistory(
      [item("july", at(2026, 6, 3)), item("june", at(2026, 5, 20))],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["July", "June"]);
  });

  it("appends the year for months in a previous year", () => {
    const groups = groupChatHistory([item("old", at(2025, 11, 2))], NOW);
    expect(groups[0]).toMatchObject({
      id: "month:2025-11",
      label: "December 2025",
    });
  });

  it("skips empty buckets and keeps recency order", () => {
    const groups = groupChatHistory(
      [item("old", at(2026, 6, 1)), item("today", at(2026, 7, 15, 1))],
      NOW,
    );
    expect(groups.map((g) => g.id)).toEqual(["today", "month:2026-6"]);
  });
});
