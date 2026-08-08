import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  KEEP_RECENT_MESSAGES,
  buildCompactionTranscript,
  formatCompactionMessage,
  messageToTranscriptLine,
  splitForCompaction,
} from "./compactChatHistory";

function msg(
  role: "user" | "assistant",
  text: string,
  id?: string,
): UIMessage {
  return {
    id: id ?? crypto.randomUUID(),
    role,
    parts: [{ type: "text", text }],
  };
}

describe("splitForCompaction", () => {
  it("keeps the last two messages and splits the rest", () => {
    const messages = [
      msg("user", "a", "11111111-1111-4111-8111-111111111111"),
      msg("assistant", "b", "22222222-2222-4222-8222-222222222222"),
      msg("user", "c", "33333333-3333-4333-8333-333333333333"),
      msg("assistant", "d", "44444444-4444-4444-8444-444444444444"),
    ];
    const { older, recent } = splitForCompaction(messages);
    expect(KEEP_RECENT_MESSAGES).toBe(2);
    expect(older.map((m) => m.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(recent.map((m) => m.id)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ]);
  });

  it("compacts nothing when history is short", () => {
    const messages = [msg("user", "a"), msg("assistant", "b")];
    const { older, recent } = splitForCompaction(messages);
    expect(older).toEqual([]);
    expect(recent).toHaveLength(2);
  });
});

describe("messageToTranscriptLine", () => {
  it("includes truncated tool output", () => {
    const line = messageToTranscriptLine({
      id: "a",
      role: "assistant",
      parts: [
        {
          type: "tool-read_note",
          toolCallId: "1",
          toolName: "read_note",
          state: "output-available",
          input: { path: "note.md" },
          output: { content: "x".repeat(2000) },
        } as UIMessage["parts"][number],
        { type: "text", text: "done" },
      ],
    });
    expect(line).toContain("tool read_note");
    expect(line).toContain("done");
    expect(line.length).toBeLessThan(2000);
  });
});

describe("buildCompactionTranscript + formatCompactionMessage", () => {
  it("joins older turns", () => {
    const t = buildCompactionTranscript([
      msg("user", "hello"),
      msg("assistant", "hi there"),
    ]);
    expect(t).toContain("User:");
    expect(t).toContain("hello");
    expect(t).toContain("Assistant:");
  });

  it("marks the summary as compacted context", () => {
    const m = formatCompactionMessage("Goals: ship compaction");
    expect(m.role).toBe("assistant");
    expect(m.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Goals: ship compaction"),
    });
    expect((m.parts[0] as { text: string }).text).toContain(
      "Earlier conversation",
    );
  });
});
