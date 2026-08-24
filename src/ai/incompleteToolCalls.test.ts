import { describe, expect, it, vi } from "vitest";
import type { ToolSet, UIMessage } from "ai";
import {
  createToolCallTracker,
  executeIncompleteParts,
  hasIncompleteToolCalls,
  INCOMPLETE_TOOL_REASON_ABORTED,
  INCOMPLETE_TOOL_REASON_DROPPED,
  isIncompleteToolPart,
  settleIncompleteToolCalls,
} from "./incompleteToolCalls";

function specialistPart(
  state: "input-available" | "output-available" | "output-error",
  extra: Record<string, unknown> = {},
): UIMessage["parts"][number] {
  return {
    type: "tool-run_specialist",
    toolCallId: "call_1",
    toolName: "run_specialist",
    state,
    input: { kind: "diagram", title: "Draw", task: "draw it" },
    ...extra,
  } as UIMessage["parts"][number];
}

describe("isIncompleteToolPart", () => {
  it("treats input-available tool calls as incomplete", () => {
    expect(isIncompleteToolPart(specialistPart("input-available"))).toBe(true);
  });

  it("treats completed tools as settled", () => {
    expect(
      isIncompleteToolPart(
        specialistPart("output-available", { output: { ok: true } }),
      ),
    ).toBe(false);
    expect(
      isIncompleteToolPart(
        specialistPart("output-error", { errorText: "nope" }),
      ),
    ).toBe(false);
  });
});

describe("settleIncompleteToolCalls", () => {
  it("closes dangling specialist calls so history can be sent again", () => {
    const messages: UIMessage[] = [
      { id: "u", role: "user", parts: [{ type: "text", text: "draw" }] },
      {
        id: "a",
        role: "assistant",
        parts: [specialistPart("input-available")],
      },
    ];
    const settled = settleIncompleteToolCalls(messages);
    expect(hasIncompleteToolCalls(settled)).toBe(false);
    const part = settled[1]!.parts[0] as {
      state: string;
      errorText?: string;
    };
    expect(part.state).toBe("output-error");
    expect(part.errorText).toBe(INCOMPLETE_TOOL_REASON_DROPPED);
  });

  it("returns the same array when nothing is pending", () => {
    const messages: UIMessage[] = [
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
    ];
    expect(settleIncompleteToolCalls(messages)).toBe(messages);
  });
});

describe("executeIncompleteParts", () => {
  it("runs dropped tools and writes output-available", async () => {
    const execute = vi.fn(async () => ({ ok: true, summary: "drew it" }));
    const tools = {
      run_specialist: { execute },
    } as unknown as ToolSet;
    const { parts, executed } = await executeIncompleteParts({
      parts: [specialistPart("input-available")],
      tools,
    });
    expect(executed).toBe(1);
    expect(execute).toHaveBeenCalledOnce();
    const part = parts[0] as { state: string; output?: { summary?: string } };
    expect(part.state).toBe("output-available");
    expect(part.output?.summary).toBe("drew it");
  });

  it("marks leftover tools cancelled when aborted", async () => {
    const tools = {
      run_specialist: { execute: vi.fn() },
    } as unknown as ToolSet;
    const controller = new AbortController();
    controller.abort();
    const { parts, executed } = await executeIncompleteParts({
      parts: [specialistPart("input-available")],
      tools,
      abortSignal: controller.signal,
    });
    expect(executed).toBe(0);
    const part = parts[0] as { state: string; errorText?: string };
    expect(part.state).toBe("output-error");
    expect(part.errorText).toBe(INCOMPLETE_TOOL_REASON_ABORTED);
  });
});

describe("createToolCallTracker", () => {
  it("lets the recovery pass wait for a slow eager run instead of repeating it", async () => {
    let release: (() => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, summary: "wrote the note" });
        }),
    );
    const tools = { run_specialist: { execute } } as unknown as ToolSet;
    const parts: UIMessage["parts"] = [specialistPart("input-available")];

    const tracker = createToolCallTracker();
    tracker.track(
      "call_1",
      executeIncompleteParts({ parts: [parts[0]!], tools }).then((done) => {
        parts[0] = done.parts[0]!;
      }),
    );

    // The stream ends while the specialist is still writing.
    expect(parts.some(isIncompleteToolPart)).toBe(true);
    release?.();
    await tracker.settle();

    expect(parts.some(isIncompleteToolPart)).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
    expect(tracker.size).toBe(0);
  });

  it("settles even when an eager run rejects", async () => {
    const tracker = createToolCallTracker();
    tracker.track("call_1", Promise.reject(new Error("boom")));
    await expect(tracker.settle()).resolves.toBeUndefined();
  });
});
