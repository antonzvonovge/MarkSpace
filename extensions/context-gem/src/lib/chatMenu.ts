import type { AnalysisMode, FreeChatKind } from "./types";

export type ChatMenuAction =
  | { kind: "analysis"; mode: AnalysisMode }
  | { kind: "free"; freeChatKind: FreeChatKind };

export type ChatMenuItem =
  | { type: "action"; id: string; title: string; action: ChatMenuAction }
  | { type: "separator"; id: string };

const FREE_CHAT_ITEMS: ChatMenuItem[] = [
  {
    type: "action",
    id: "general-chat",
    title: "New chat",
    action: { kind: "free", freeChatKind: "general" },
  },
  {
    type: "action",
    id: "dictionary-chat",
    title: "Dictionary chat",
    action: { kind: "free", freeChatKind: "dictionary" },
  },
];

const SELECTION_ANALYSIS_ITEMS: ChatMenuItem[] = [
  {
    type: "action",
    id: "teaching",
    title: "Explain for class",
    action: { kind: "analysis", mode: "teaching" },
  },
  {
    type: "action",
    id: "professional",
    title: "Expert analysis for teacher",
    action: { kind: "analysis", mode: "professional" },
  },
  {
    type: "action",
    id: "student",
    title: "Explain for IELTS student",
    action: { kind: "analysis", mode: "student" },
  },
];

export function freeChatModeMenuLabel(kind: FreeChatKind): string {
  const item = FREE_CHAT_ITEMS.find(
    (entry) =>
      entry.type === "action" &&
      entry.action.kind === "free" &&
      entry.action.freeChatKind === kind,
  );
  return item?.type === "action" ? item.title : "New chat";
}

export function analysisModeMenuLabel(mode: AnalysisMode): string {
  const item = SELECTION_ANALYSIS_ITEMS.find(
    (entry) =>
      entry.type === "action" &&
      entry.action.kind === "analysis" &&
      entry.action.mode === mode,
  );
  return item?.type === "action" ? item.title : "Explain for class";
}

export function getChatMenuItems(): ChatMenuItem[] {
  return [
    ...SELECTION_ANALYSIS_ITEMS,
    { type: "separator", id: "menu-separator" },
    ...FREE_CHAT_ITEMS,
  ];
}
