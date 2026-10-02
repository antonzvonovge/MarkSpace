import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  WIDGET_CLOSE,
  WIDGET_OPEN,
  lastClosedWidgetBlock,
  widgetSectionFromMessages,
} from "./routineWidgetSection";

function wrap(body: string): string {
  return `${WIDGET_OPEN}\n${body}\n${WIDGET_CLOSE}`;
}

function terminal(stdout: string, extra?: { stderr?: string }): UIMessage {
  return {
    id: "t",
    role: "assistant",
    parts: [
      {
        type: "tool-run_terminal",
        toolCallId: "call",
        state: "output-available",
        input: { command: "agent" },
        output: {
          ok: true,
          stdout,
          stderr: extra?.stderr ?? "",
          exit_code: 0,
        },
      },
    ],
  } as UIMessage;
}

function reply(text: string): UIMessage {
  return {
    id: "a",
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}

describe("lastClosedWidgetBlock", () => {
  it("returns the last closed block and drops the tail", () => {
    const text = `${wrap("first")}\nlog\n${wrap("second")}\n${WIDGET_OPEN}\ncut off`;
    expect(lastClosedWidgetBlock(text)).toBe("second");
  });

  it("ignores an unclosed block", () => {
    expect(lastClosedWidgetBlock(`${WIDGET_OPEN}\nhalf a card`)).toBeNull();
  });

  it("skips an empty block and keeps the earlier one", () => {
    expect(lastClosedWidgetBlock(`${wrap("kept")}\n${wrap("   ")}`)).toBe("kept");
  });
});

describe("widgetSectionFromMessages", () => {
  it("uses the last closed stdout block", () => {
    const section = widgetSectionFromMessages([
      terminal(`${wrap("one")}\nnoise`),
      terminal(`${WIDGET_OPEN}\ncut`),
      terminal(wrap("two")),
    ]);
    expect(section).toBe("two");
  });

  it("keeps an earlier stdout block when a later command is unclosed", () => {
    const section = widgetSectionFromMessages([
      terminal(wrap("kept")),
      terminal(`${WIDGET_OPEN}\ntruncated`),
    ]);
    expect(section).toBe("kept");
  });

  it("prefers stdout over the same block in the reply", () => {
    const section = widgetSectionFromMessages([
      terminal(wrap("from the command")),
      reply(wrap("from the model")),
    ]);
    expect(section).toBe("from the command");
  });

  it("falls back to the final reply when stdout has no closed block", () => {
    const section = widgetSectionFromMessages([
      terminal("just a log"),
      reply(`summary\n\n${wrap("from the model")}`),
    ]);
    expect(section).toBe("from the model");
  });

  it("ignores a block that is only on stderr", () => {
    const section = widgetSectionFromMessages([
      terminal("log", { stderr: wrap("hidden") }),
      reply("no markers here"),
    ]);
    expect(section).toBeNull();
  });
});
