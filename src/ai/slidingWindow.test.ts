import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { estimateModelMessagesTokens, estimateTokensFromText } from "./estimateTokens";
import {
  KEEP_RECENT_TOOL_RESULTS,
  TOOL_RESULT_OMITTED_PREFIX,
  applySlidingWindow,
  isCompactionModelMessage,
  messageTokenBudget,
  windowModelMessages,
} from "./slidingWindow";

function user(text: string): ModelMessage {
  return { role: "user", content: text };
}

function assistantText(text: string): ModelMessage {
  return { role: "assistant", content: text };
}

function toolPair(
  id: string,
  toolName: string,
  path: string,
  output: string,
): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: id,
          toolName,
          input: { path },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName,
          output: { type: "text", value: output },
        },
      ],
    },
  ];
}

function resultValues(messages: ModelMessage[]): string[] {
  const out: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "tool-result" &&
        "output" in part
      ) {
        const output = (part as { output: unknown }).output;
        if (
          typeof output === "object" &&
          output !== null &&
          "value" in output &&
          typeof (output as { value: unknown }).value === "string"
        ) {
          out.push((output as { value: string }).value);
        }
      }
    }
  }
  return out;
}

function toolCallIds(messages: ModelMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "tool-call" &&
        "toolCallId" in part
      ) {
        ids.push(String((part as { toolCallId: string }).toolCallId));
      }
    }
  }
  return ids;
}

function toolResultIds(messages: ModelMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "tool-result" &&
        "toolCallId" in part
      ) {
        ids.push(String((part as { toolCallId: string }).toolCallId));
      }
    }
  }
  return ids;
}

function lastUserText(messages: ModelMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") {
      return typeof m.content === "string" ? m.content : undefined;
    }
  }
  return undefined;
}

describe("windowModelMessages", () => {
  it("returns the same array when history fits the budget", () => {
    const messages: ModelMessage[] = [
      user("hello"),
      assistantText("hi there"),
    ];
    const budget = estimateModelMessagesTokens(messages) + 50;
    expect(windowModelMessages(messages, budget)).toBe(messages);
  });

  it("stubs older tool results and keeps the newest ones full", () => {
    const payload = "FULL-" + "x".repeat(8_000);
    const messages: ModelMessage[] = [
      user("read several notes"),
      ...toolPair("c1", "read_note", "a.md", payload),
      ...toolPair("c2", "read_note", "b.md", payload),
      ...toolPair("c3", "read_note", "c.md", payload),
      ...toolPair("c4", "read_note", "d.md", payload),
      ...toolPair("c5", "read_note", "e.md", payload),
    ];
    const keepLast = KEEP_RECENT_TOOL_RESULTS;
    expect(keepLast).toBe(3);

    const five = estimateModelMessagesTokens(messages);
    const budget = Math.floor(five * 0.72);
    expect(budget).toBeLessThan(five);

    const windowed = windowModelMessages(messages, budget);
    expect(windowed).not.toBe(messages);

    const values = resultValues(windowed);
    expect(values).toHaveLength(5);
    expect(values.slice(0, -keepLast).every((v) => v.startsWith(TOOL_RESULT_OMITTED_PREFIX))).toBe(
      true,
    );
    expect(values.slice(-keepLast).every((v) => v.startsWith("FULL-"))).toBe(true);
    expect(values[0]).toContain("a.md");
    expect(values[0]).toContain("read_note");
    // Request-only: the input array is unchanged.
    expect(resultValues(messages).every((v) => v.startsWith("FULL-"))).toBe(true);
  });

  it("never splits tool-call / tool-result pairs", () => {
    const payload = "y".repeat(6_000);
    const messages: ModelMessage[] = [
      user("go"),
      ...toolPair("a", "read_note", "one.md", payload),
      ...toolPair("b", "read_note", "two.md", payload),
      ...toolPair("c", "read_note", "three.md", payload),
      user("continue"),
      ...toolPair("d", "read_note", "four.md", payload),
    ];
    const budget = Math.floor(estimateModelMessagesTokens(messages) * 0.4);
    const windowed = windowModelMessages(messages, budget);
    const calls = toolCallIds(windowed).sort();
    const results = toolResultIds(windowed).sort();
    expect(calls).toEqual(results);
    expect(lastUserText(windowed)).toBe("continue");
  });

  it("keeps the last user message and the compaction brief when dropping turns", () => {
    const bulky = "z".repeat(12_000);
    const messages: ModelMessage[] = [
      assistantText(
        "Context compacted to free space for new messages.\n\n### Earlier conversation\n\nGoals: ship the window",
      ),
      user("old question"),
      assistantText(bulky),
      user("new question"),
    ];
    expect(isCompactionModelMessage(messages[0]!)).toBe(true);

    const budget = Math.max(
      200,
      estimateTokensFromText("new question") + 80,
    );
    const windowed = windowModelMessages(messages, budget);
    expect(windowed.some(isCompactionModelMessage)).toBe(true);
    expect(lastUserText(windowed)).toBe("new question");
    expect(windowed.some((m) => m.role === "user" && m.content === "old question")).toBe(
      false,
    );
  });

  it("stubs a single oversized tool result instead of failing the step", () => {
    const huge = "H".repeat(40_000);
    const messages: ModelMessage[] = [
      user("read this"),
      ...toolPair("only", "read_note", "big.md", huge),
    ];
    const full = estimateModelMessagesTokens(messages);
    const budget = Math.min(2_000, Math.floor(full / 8));
    expect(budget).toBeLessThan(full);

    const windowed = windowModelMessages(messages, budget);
    const values = resultValues(windowed);
    expect(values).toHaveLength(1);
    expect(values[0]).toContain(TOOL_RESULT_OMITTED_PREFIX);
    expect(values[0]).toContain("big.md");
    expect(lastUserText(windowed)).toBe("read this");
    expect(toolCallIds(windowed)).toEqual(toolResultIds(windowed));
  });
});

describe("applySlidingWindow / messageTokenBudget", () => {
  it("throws when even the stubbed latest turn cannot fit", () => {
    const messages: ModelMessage[] = [
      user("U".repeat(50_000)),
    ];
    expect(() =>
      applySlidingWindow({
        messages,
        contextWindow: 20_000,
        extraTokens: 0,
      }),
    ).toThrow(/Context window is full/);
  });

  it("budget is context window minus the safety margin", () => {
    expect(messageTokenBudget(200_000, 0)).toBe(190_000);
    expect(messageTokenBudget(100_000, 2_000)).toBe(90_000);
  });
});
