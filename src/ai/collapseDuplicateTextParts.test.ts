import { describe, expect, it } from "vitest";
import {
  assistantTextPartsAreDuplicates,
  collapseDuplicateTextParts,
} from "./collapseDuplicateTextParts";

const recaps = [
  "Готово, Антон. Тренировка завершена, а заметка с результатом **0/10**, разбором ошибок, ключами и полным скриптом открыта:\n\n[[English/IELTS/a.md|IELTS Listening]]",
  "Готово, Антон. Тренировка завершена, заметка с результатом **0/10**, разбором ошибок, ответами и полным скриптом открыта:\n\n[[English/IELTS/a.md|IELTS Listening]]",
  "Готово, Антон. Тренировка завершена, заметка открыта:\n\n[[English/IELTS/a.md|IELTS Listening]]\n\nВнутри: результат **0/10**, разбор ловушек, правильные ответы и полный скрипт аудио.",
  "Готово, Антон. Заметка с результатом **0/10**, разбором ловушек, правильными ответами и полным скриптом открыта:\n\n[[English/IELTS/a.md|IELTS Listening]]",
  "Готово, Антон. Тренировка завершена, заметка открыта:\n\n[[English/IELTS/a.md|IELTS Listening]]\n\nВнутри: результат **0/10**, разбор ловушек, правильные ответы",
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
});
