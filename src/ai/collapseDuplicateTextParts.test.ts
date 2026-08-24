import { describe, expect, it } from "vitest";
import {
  assistantTextPartsAreDuplicates,
  collapseDuplicateTextParts,
} from "./collapseDuplicateTextParts";

const recaps = [
  "Готово, Антон. Тренировка завершена, а заметка с результатом **0/10**, разбором ошибок, ключами и полным скриптом открыта:\n\n[[English/IELTS/a.md|IELTS Listening]]",
  "Готово, Антон. Тренировка завершена, заметка с результатом **0/10**, разбором ошибок, ответами и полным скриптом открыта:\n\n[[English/IELTS/a.md|IELTS Listening]]",
  "Готово, Антон. Тренировка завершена, заметка открыта:\n\n[[English/IELTS/a.md|IELTS Listening]]\n\nВнутри: результат **0/10**, разбор ловушек, правильные ответы и полный скрипт аудио.",
];

describe("assistantTextPartsAreDuplicates", () => {
  it("treats Gemini IELTS closing recaps as the same message", () => {
    for (let i = 1; i < recaps.length; i++) {
      expect(assistantTextPartsAreDuplicates(recaps[0]!, recaps[i]!)).toBe(true);
    }
  });

  it("does not merge unrelated replies", () => {
    expect(
      assistantTextPartsAreDuplicates(
        recaps[0]!,
        "Section 1 is a conversation about booking a workshop.",
      ),
    ).toBe(false);
  });
});

describe("collapseDuplicateTextParts", () => {
  it("keeps one copy of stacked recaps", () => {
    const parts = recaps.map((text) => ({ type: "text" as const, text }));
    const out = collapseDuplicateTextParts(parts);
    expect(out).toHaveLength(1);
    expect((out[0] as { text: string }).text).toContain("0/10");
  });

  it("collapses several rewritten answers even if a short aside sits between them", () => {
    const aside = "Сохраняем заметку в проект?";
    const out = collapseDuplicateTextParts([
      { type: "text", text: recaps[0]! },
      { type: "reasoning", text: "again", state: "done" },
      { type: "text", text: recaps[1]! },
      { type: "text", text: aside },
      { type: "text", text: recaps[2]! },
    ]);
    const texts = out.filter((p) => p.type === "text") as { text: string }[];
    expect(texts.filter((p) => p.text.includes("0/10"))).toHaveLength(1);
    expect(texts.some((p) => p.text === aside)).toBe(true);
  });

  it("does not drop a new answer after a tool call", () => {
    const out = collapseDuplicateTextParts([
      { type: "text", text: recaps[0]! },
      {
        type: "tool-search",
        toolCallId: "c1",
        state: "output-available",
        input: {},
        output: {},
      },
      { type: "text", text: recaps[1]! },
    ]);
    expect(out.filter((p) => p.type === "text")).toHaveLength(2);
  });
});
