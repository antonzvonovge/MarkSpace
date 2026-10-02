import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  WIDGET_CLOSE,
  WIDGET_OPEN,
  composeRoutineReport,
  formatRoutineActivity,
  lastClosedWidgetBlock,
  routineCardFromRun,
  widgetCardFromModelText,
  widgetSectionFromMessages,
  widgetSynthesisMaterial,
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

  it("prefers the reply block over stdout", () => {
    const section = widgetSectionFromMessages([
      terminal(wrap("from the command")),
      reply(wrap("from the model")),
    ]);
    expect(section).toBe("from the model");
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

  it("keeps a stdout block when the reply left its block unclosed", () => {
    const section = widgetSectionFromMessages([
      terminal(wrap("from the command")),
      reply(`${WIDGET_OPEN}\ncut off`),
    ]);
    expect(section).toBe("from the command");
  });
});

describe("routineCardFromRun", () => {
  it("uses the last command stdout when the reply is only a status", () => {
    const card = routineCardFromRun([
      terminal("14:21:05"),
      reply("Done"),
    ]);
    expect(card).toBe("14:21:05");
  });

  it("uses the reply when the terminal printed nothing", () => {
    expect(routineCardFromRun([reply("The time is 14:21.")])).toBe("The time is 14:21.");
  });
});

describe("widgetSynthesisMaterial", () => {
  it("includes the brief, stdout, and reply", () => {
    const material = widgetSynthesisMaterial([
      {
        id: "u",
        role: "user",
        parts: [{ type: "text", text: "Echo the time" }],
      },
      terminal("Fri Oct 2 14:21:05"),
      reply("Done"),
    ]);
    expect(material).toContain("Echo the time");
    expect(material).toContain("Fri Oct 2 14:21:05");
    expect(material).toContain("Done");
  });

  it("is empty when the run produced neither output nor a reply", () => {
    expect(widgetSynthesisMaterial([])).toBeNull();
  });
});

describe("widgetCardFromModelText", () => {
  it("unwraps a closed block", () => {
    expect(widgetCardFromModelText(wrap("14:21"))).toBe("14:21");
  });

  it("keeps a plain reply when the markers are missing", () => {
    expect(widgetCardFromModelText("14:21")).toBe("14:21");
  });

  it("drops a fenced wrapper around the block", () => {
    expect(widgetCardFromModelText("```\n" + wrap("14:21") + "\n```")).toBe("14:21");
  });

  it("returns null for whitespace", () => {
    expect(widgetCardFromModelText("  \n")).toBeNull();
  });
});

describe("formatRoutineActivity", () => {
  it("keeps thoughts, the reply, and the terminal command", () => {
    const log = formatRoutineActivity([
      {
        id: "a",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Need the clock.", state: "done" },
          { type: "text", text: "Checking the time." },
          {
            type: "tool-run_terminal",
            toolCallId: "call",
            state: "output-available",
            input: { command: "date" },
            output: { ok: true, stdout: "14:21:05\n", stderr: "", exit_code: 0 },
          },
          { type: "text", text: wrap("14:21") },
        ],
      } as UIMessage,
    ]);
    expect(log).toContain("## Activity");
    expect(log).toContain("Need the clock.");
    expect(log).toContain("Checking the time.");
    expect(log).toContain("**run_terminal**");
    expect(log).toContain("date");
    expect(log).toContain("14:21:05");
    expect(log).toContain("14:21");
  });
});

describe("composeRoutineReport", () => {
  it("appends a widget block when the log does not already end with that card", () => {
    const report = composeRoutineReport("## Activity\n\n**Reply**\n\nDone", "14:21");
    expect(report).toContain("## Activity");
    expect(report).toContain("Done");
    expect(report).toContain(wrap("14:21"));
  });

  it("does not repeat a card that is already the last widget block", () => {
    const trace = `## Activity\n\n**Reply**\n\n${wrap("14:21")}`;
    expect(composeRoutineReport(trace, "14:21")).toBe(trace);
  });
});
