import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  buildContextAnchor,
  contextSafetyMargin,
  estimateTokensFromText,
  estimateToolSchemaTokens,
  estimateTrailingAssistantOutput,
  estimateUsedContext,
  wouldExceedContext,
} from "./estimateTokens";

describe("estimateTokensFromText", () => {
  it("counts ASCII cheaper than Cyrillic", () => {
    const en = estimateTokensFromText("hello world test");
    const ru = estimateTokensFromText("привет мир тест");
    expect(ru).toBeGreaterThan(en);
  });
});

describe("estimateToolSchemaTokens", () => {
  it("counts ask tools above fixed overhead; agent orchestrator is leaner than ask", () => {
    const ask = estimateToolSchemaTokens("ask");
    const agent = estimateToolSchemaTokens("agent");
    expect(ask).toBeGreaterThan(2_000);
    // Orchestrator (8 tools) should be well under the old full-agent ~8k+.
    expect(agent).toBeLessThan(ask);
    expect(agent).toBeLessThan(8_000);
    expect(agent).toBeGreaterThan(500);
  });
});

describe("contextSafetyMargin / wouldExceedContext", () => {
  it("uses at least 8k margin", () => {
    expect(contextSafetyMargin(100_000)).toBe(8_000);
    expect(contextSafetyMargin(200_000)).toBe(10_000);
  });

  it("blocks when remaining is below the margin", () => {
    expect(wouldExceedContext(190_000, 200_000)).toBe(true);
    expect(wouldExceedContext(50_000, 200_000)).toBe(false);
  });
});

describe("estimateTrailingAssistantOutput", () => {
  it("counts only text after the last tool part", () => {
    const msg: UIMessage = {
      id: "a",
      role: "assistant",
      parts: [
        {
          type: "tool-read_note",
          toolCallId: "1",
          toolName: "read_note",
          state: "output-available",
          input: { path: "a.md" },
          output: { content: "x".repeat(400) },
        } as UIMessage["parts"][number],
        { type: "text", text: "hello" },
      ],
    };
    const trailing = estimateTrailingAssistantOutput(msg);
    expect(trailing).toBe(estimateTokensFromText("hello") + 4);
  });
});

describe("estimateUsedContext + anchor", () => {
  it("adds only the draft on top of a matching anchor", () => {
    const messages: UIMessage[] = [
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
    ];
    const used = estimateUsedContext({
      system: "sys",
      messages,
      draft: "abcd",
      mode: "ask",
      anchor: { tokens: 50_000, messageCount: 1 },
    });
    expect(used).toBe(50_000 + estimateTokensFromText("abcd"));
  });

  it("buildContextAnchor prefers measured input + trailing text", () => {
    const messages: UIMessage[] = [
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "a",
        role: "assistant",
        parts: [{ type: "text", text: "ok" }],
      },
    ];
    const anchor = buildContextAnchor({
      lastStepInputTokens: 12_000,
      messages,
      system: "sys",
      mode: "ask",
    });
    expect(anchor.messageCount).toBe(2);
    expect(anchor.tokens).toBe(
      12_000 + estimateTrailingAssistantOutput(messages[1]!),
    );
  });
});
