import { isToolUIPart, type UIMessage } from "ai";

/** Closed block a routine command prints on stdout to fill the dashboard card. */
export const WIDGET_OPEN = "<!-- widget -->";
export const WIDGET_CLOSE = "<!-- /widget -->";

export const WIDGET_SECTION_EXAMPLE = `${WIDGET_OPEN}\nmarkdown for the card\n${WIDGET_CLOSE}`;

export const WIDGET_SECTION_HINT =
  "The dashboard widget shows the last closed block from command stdout. If stdout has no closed block, the same block in the final reply is used.";

export const WIDGET_SECTION_PROMPT = [
  "Dashboard widget: the card shows only the last closed block from run_terminal stdout. Print it from the command itself, not from a terminal specialist summary. If no command prints a closed block, put the same block in your final reply. An unclosed block is ignored. Everything outside the markers is ignored.",
  WIDGET_SECTION_EXAMPLE,
].join("\n\n");

export const WIDGET_SECTION_MISSING = [
  "No widget section in this run. To fill the dashboard card, print this block on stdout:",
  "```",
  WIDGET_SECTION_EXAMPLE,
  "```",
].join("\n");

/** Last non-empty closed widget block in `text`. An unclosed tail is ignored. */
export function lastClosedWidgetBlock(text: string): string | null {
  let closeAt = text.lastIndexOf(WIDGET_CLOSE);
  while (closeAt !== -1) {
    const openAt = text.lastIndexOf(WIDGET_OPEN, closeAt);
    if (openAt !== -1) {
      const body = text.slice(openAt + WIDGET_OPEN.length, closeAt).trim();
      if (body) return body;
    }
    if (closeAt === 0) break;
    closeAt = text.lastIndexOf(WIDGET_CLOSE, closeAt - 1);
  }
  return null;
}

function terminalStdout(part: UIMessage["parts"][number]): string | null {
  if (!isToolUIPart(part)) return null;
  const name =
    "toolName" in part && typeof part.toolName === "string"
      ? part.toolName
      : part.type.startsWith("tool-")
        ? part.type.slice("tool-".length)
        : "";
  if (name !== "run_terminal") return null;
  if (!("state" in part) || part.state !== "output-available") return null;
  if (!("output" in part) || !part.output || typeof part.output !== "object") return null;
  const stdout = (part.output as { stdout?: unknown }).stdout;
  return typeof stdout === "string" ? stdout : null;
}

/**
 * Widget body for a finished routine run.
 * Last closed block across `run_terminal` stdout wins. Assistant text is the fallback.
 */
export function widgetSectionFromMessages(messages: UIMessage[]): string | null {
  let fromStdout: string | null = null;
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const stdout = terminalStdout(part);
      if (stdout == null) continue;
      const block = lastClosedWidgetBlock(stdout);
      if (block) fromStdout = block;
    }
  }
  if (fromStdout) return fromStdout;

  const chunks: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part.type === "text" && part.text) chunks.push(part.text);
    }
  }
  return lastClosedWidgetBlock(chunks.join("\n\n"));
}
