export type ChatHistoryGroupId =
  | "today"
  | "yesterday"
  | "previous7"
  | "previous30"
  | `month:${number}-${number}`;

export type ChatHistoryGroup<T> = {
  id: ChatHistoryGroupId;
  /** Null for Today — Cursor-style first bucket has no header. */
  label: string | null;
  items: T[];
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function addDays(dayStartMs: number, days: number): number {
  const d = new Date(dayStartMs);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function monthLabel(year: number, month: number, nowYear: number): string {
  const name = MONTH_NAMES[month];
  return year === nowYear ? name : `${name} ${year}`;
}

function bucketFor(
  updatedAt: number,
  todayStart: number,
  nowYear: number,
): { id: ChatHistoryGroupId; label: string | null } {
  const yesterdayStart = addDays(todayStart, -1);
  const previous7Start = addDays(todayStart, -7);
  const previous30Start = addDays(todayStart, -30);

  if (updatedAt >= todayStart) {
    return { id: "today", label: null };
  }
  if (updatedAt >= yesterdayStart) {
    return { id: "yesterday", label: "Yesterday" };
  }
  if (updatedAt >= previous7Start) {
    return { id: "previous7", label: "Previous 7 days" };
  }
  if (updatedAt >= previous30Start) {
    return { id: "previous30", label: "Previous 30 days" };
  }

  const d = new Date(updatedAt);
  const year = d.getFullYear();
  const month = d.getMonth();
  return {
    id: `month:${year}-${month}`,
    label: monthLabel(year, month, nowYear),
  };
}

const FIXED_ORDER: ChatHistoryGroupId[] = [
  "today",
  "yesterday",
  "previous7",
  "previous30",
];

/**
 * Group chats by recency buckets (Today / Yesterday / Previous 7 days /
 * Previous 30 days / calendar month), newest first within each group.
 */
export function groupChatHistory<T extends { updatedAt: number }>(
  items: T[],
  now: number = Date.now(),
): ChatHistoryGroup<T>[] {
  const todayStart = startOfLocalDay(now);
  const nowYear = new Date(now).getFullYear();
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  const byId = new Map<ChatHistoryGroupId, ChatHistoryGroup<T>>();

  for (const item of sorted) {
    const { id, label } = bucketFor(item.updatedAt, todayStart, nowYear);
    const group = byId.get(id);
    if (group) {
      group.items.push(item);
    } else {
      byId.set(id, { id, label, items: [item] });
    }
  }

  const groups: ChatHistoryGroup<T>[] = [];
  for (const id of FIXED_ORDER) {
    const group = byId.get(id);
    if (group) groups.push(group);
  }

  const monthGroups = [...byId.values()]
    .filter((g) => g.id.startsWith("month:"))
    .sort((a, b) => {
      const aTime = a.items[0]?.updatedAt ?? 0;
      const bTime = b.items[0]?.updatedAt ?? 0;
      return bTime - aTime;
    });
  groups.push(...monthGroups);

  return groups;
}
