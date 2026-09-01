import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  applyRecentUserTurnLimit,
  sliceToRecentUserTurns,
} from "./recentUserTurns";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function assistantParts(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, role: "assistant", parts };
}

describe("sliceToRecentUserTurns", () => {
  it("returns all messages when under the limit", () => {
    const messages = [user("u1", "a"), assistant("a1", "b"), user("u2", "c")];
    expect(sliceToRecentUserTurns(messages, 3)).toEqual(messages);
    expect(sliceToRecentUserTurns(messages, 2)).toEqual(messages);
  });

  it("keeps the last N user turns with assistant replies", () => {
    const messages = [
      user("u1", "one"),
      assistant("a1", "reply one"),
      user("u2", "two"),
      assistant("a2", "reply two"),
      user("u3", "three"),
      assistant("a3", "reply three"),
    ];
    expect(sliceToRecentUserTurns(messages, 1)).toEqual([
      user("u3", "three"),
      assistant("a3", "reply three"),
    ]);
    expect(sliceToRecentUserTurns(messages, 2)).toEqual([
      user("u2", "two"),
      assistant("a2", "reply two"),
      user("u3", "three"),
      assistant("a3", "reply three"),
    ]);
  });

  it("includes reasoning and tool parts in the assistant half of a turn", () => {
    const messages = [
      user("u1", "old"),
      assistant("a1", "old reply"),
      user("u2", "new"),
      assistantParts("a2", [
        { type: "reasoning", text: "think", state: "done" },
        { type: "text", text: "answer" },
      ]),
    ];
    expect(sliceToRecentUserTurns(messages, 1)).toEqual(messages.slice(2));
  });
});

describe("applyRecentUserTurnLimit", () => {
  it("passes through when unset", () => {
    const messages = [user("u1", "a")];
    expect(applyRecentUserTurnLimit(messages, null)).toBe(messages);
    expect(applyRecentUserTurnLimit(messages, undefined)).toBe(messages);
  });

  it("applies the cap when set", () => {
    const messages = [
      user("u1", "one"),
      assistant("a1", "reply"),
      user("u2", "two"),
    ];
    expect(applyRecentUserTurnLimit(messages, 1)).toEqual([user("u2", "two")]);
  });
});
