import { generateText, isToolUIPart, type UIMessage } from "ai";
import { unwrapComposerMarkers } from "../lib/chatComposerDom";
import {
  resolveLanguageModel,
  runWithModelFallback,
  type AiProviderCredentials,
} from "./languageModel";

/** Closed block a routine writes to fill the dashboard card. */
export const WIDGET_OPEN = "<!-- widget -->";
export const WIDGET_CLOSE = "<!-- /widget -->";

export const WIDGET_SECTION_EXAMPLE = `${WIDGET_OPEN}\nmarkdown for the card\n${WIDGET_CLOSE}`;

/** Run-file heading for the agent's thoughts, replies, and tool calls. */
export const ROUTINE_ACTIVITY_HEADING = "## Activity";

export const WIDGET_SECTION_PROMPT = [
  "CRITICAL — Dashboard widget: end your final reply with exactly one closed block. A dashboard card, when this routine is placed on one, shows only that block. The run log still keeps your reply, thoughts, and tool calls. Write the card by meaning from the run result: the fact the brief asked for, in short markdown. When a command prints raw output, read it and put the meaningful result in the block yourself. Do not paste a raw log. Do not write only Done, OK, or a status word. An unclosed block is ignored.",
  WIDGET_SECTION_EXAMPLE,
].join("\n\n");

const WIDGET_SYNTHESIS_SYSTEM = `You write the dashboard card for a finished routine.
Reply with ONLY one closed block:

${WIDGET_SECTION_EXAMPLE}

The block is the result by meaning: the fact the brief asked for, in short markdown. Use the command output and the assistant reply. Do not dump the raw log. Do not write only Done, OK, or a status word. No text outside the block.`;

const BRIEF_CAP = 2000;
const REPLY_CAP = 4000;
const STDOUT_CAP = 8000;

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

function assistantChunks(messages: UIMessage[]): string[] {
  const chunks: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part.type === "text" && part.text) chunks.push(part.text);
    }
  }
  return chunks;
}

/** Last non-empty `run_terminal` stdout, trimmed. */
export function lastNonEmptyTerminalStdout(messages: UIMessage[]): string | null {
  let found: string | null = null;
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const stdout = terminalStdout(part)?.trim();
      if (stdout) found = stdout;
    }
  }
  return found;
}

/** Text of the last assistant message that said something. */
export function lastAssistantReply(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    const chunks: string[] = [];
    for (const part of message.parts ?? []) {
      if (part.type === "text" && part.text.trim()) chunks.push(part.text.trim());
    }
    const text = chunks.join("\n\n").trim();
    if (text) return text;
  }
  return "";
}

function lastUserBrief(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    const chunks: string[] = [];
    for (const part of message.parts ?? []) {
      if (part.type === "text" && part.text.trim()) chunks.push(part.text);
    }
    const text = unwrapComposerMarkers(chunks.join("\n")).trim();
    if (text) return text;
  }
  return "";
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

/**
 * Widget body for a finished routine run.
 * A closed block in the assistant reply wins. Otherwise the last closed block from `run_terminal` stdout.
 */
export function widgetSectionFromMessages(messages: UIMessage[]): string | null {
  const fromReply = lastClosedWidgetBlock(assistantChunks(messages).join("\n\n"));
  if (fromReply) return fromReply;

  let fromStdout: string | null = null;
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const stdout = terminalStdout(part);
      if (stdout == null) continue;
      const block = lastClosedWidgetBlock(stdout);
      if (block) fromStdout = block;
    }
  }
  return fromStdout;
}

/**
 * Card text when the run never closed a widget block and the follow-up did not write one.
 * Command stdout wins over a plain reply such as "Done". The reply is used when the terminal printed nothing.
 */
export function routineCardFromRun(messages: UIMessage[]): string | null {
  const stdout = lastNonEmptyTerminalStdout(messages);
  if (stdout) return stdout;
  const reply = lastAssistantReply(messages);
  return reply || null;
}

/** Brief, stdout, and reply for the follow-up that writes the card. Null when the run produced neither output nor a reply. */
export function widgetSynthesisMaterial(messages: UIMessage[]): string | null {
  const stdout = lastNonEmptyTerminalStdout(messages) ?? "";
  const reply = lastAssistantReply(messages);
  if (!stdout && !reply) return null;
  const parts: string[] = [];
  const brief = clip(lastUserBrief(messages), BRIEF_CAP);
  if (brief) parts.push(`Brief:\n${brief}`);
  const command = clip(stdout, STDOUT_CAP);
  if (command) parts.push(`Command stdout:\n${command}`);
  const spoken = clip(reply, REPLY_CAP);
  if (spoken) parts.push(`Assistant reply:\n${spoken}`);
  return parts.join("\n\n");
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

/** Closed widget body, or the whole reply when the follow-up forgot the markers. */
export function widgetCardFromModelText(text: string): string | null {
  const stripped = stripFence(text);
  const block = lastClosedWidgetBlock(stripped);
  if (block) return block;
  return stripped || null;
}

export async function synthesizeRoutineWidget(params: {
  material: string;
  keys: AiProviderCredentials;
  modelId?: string;
  fallbackModelId?: string;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  const material = params.material.trim();
  if (!material) return null;

  const tryModel = async (modelId: string) => {
    const resolved = resolveLanguageModel({
      modelId,
      keys: params.keys,
      enableReasoning: false,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: WIDGET_SYNTHESIS_SYSTEM,
      prompt: material,
      maxOutputTokens: 500,
      abortSignal: params.abortSignal,
      temperature: 0,
    });
    return widgetCardFromModelText(text);
  };

  return await runWithModelFallback({
    keys: params.keys,
    modelId: params.modelId,
    fallbackModelId: params.fallbackModelId,
    isEmpty: (card) => !card,
    run: tryModel,
  });
}

const TRACE_CAP = 8000;

function toolNameOf(part: UIMessage["parts"][number]): string {
  if ("toolName" in part && typeof part.toolName === "string") return part.toolName;
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  return part.type;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function payloadText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return clip(value, TRACE_CAP);
  try {
    const raw = JSON.stringify(value, null, 2);
    if (!raw || raw === "{}" || raw === "null") return "";
    return clip(raw, TRACE_CAP);
  } catch {
    return clip(String(value), TRACE_CAP);
  }
}

function formatTerminalCall(part: UIMessage["parts"][number]): string {
  const input = "input" in part ? asRecord(part.input) : null;
  const command = typeof input?.command === "string" ? input.command.trim() : "";
  const lines = ["**run_terminal**"];
  if (command) lines.push("", "```", command, "```");
  const output = "output" in part ? asRecord(part.output) : null;
  const stdout = typeof output?.stdout === "string" ? output.stdout.trim() : "";
  const stderr = typeof output?.stderr === "string" ? output.stderr.trim() : "";
  if (stdout) lines.push("", "```", clip(stdout, TRACE_CAP), "```");
  if (stderr) lines.push("", "stderr:", "", "```", clip(stderr, TRACE_CAP), "```");
  if (typeof output?.exit_code === "number" && output.exit_code !== 0) {
    lines.push("", `Exit: ${output.exit_code}`);
  }
  if ("errorText" in part && typeof part.errorText === "string" && part.errorText.trim()) {
    lines.push("", clip(part.errorText.trim(), TRACE_CAP));
  }
  return lines.join("\n");
}

function formatToolCall(part: UIMessage["parts"][number]): string {
  const name = toolNameOf(part);
  if (name === "run_terminal") return formatTerminalCall(part);
  const lines = [`**${name}**`];
  const inputText = "input" in part ? payloadText(part.input) : "";
  if (inputText) lines.push("", "```", inputText, "```");
  const outputText = "output" in part ? payloadText(part.output) : "";
  if (outputText) lines.push("", "Result:", "", "```", outputText, "```");
  if ("errorText" in part && typeof part.errorText === "string" && part.errorText.trim()) {
    lines.push("", clip(part.errorText.trim(), TRACE_CAP));
  }
  return lines.join("\n");
}

/** Markdown log of thoughts, replies, and tool calls. Empty when the assistant left no trace. */
export function formatRoutineActivity(messages: UIMessage[]): string {
  const blocks: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part.type === "reasoning" && "text" in part && typeof part.text === "string" && part.text.trim()) {
        blocks.push(`**Thought**\n\n${clip(part.text.trim(), TRACE_CAP)}`);
        continue;
      }
      if (part.type === "text" && part.text.trim()) {
        blocks.push(`**Reply**\n\n${clip(part.text.trim(), TRACE_CAP)}`);
        continue;
      }
      if (isToolUIPart(part)) blocks.push(formatToolCall(part));
    }
  }
  if (blocks.length === 0) return "";
  return `${ROUTINE_ACTIVITY_HEADING}\n\n${blocks.join("\n\n")}`;
}

/**
 * Run file body. The activity log stays intact.
 * A card that is not already the last closed widget block is appended so a dashboard can lift it out.
 */
export function composeRoutineReport(trace: string, card: string | null): string {
  const activity = trace.trim();
  const body = card?.trim() ?? "";
  if (!body) return activity;
  if (lastClosedWidgetBlock(activity) === body) return activity;
  const wrapped = `${WIDGET_OPEN}\n${body}\n${WIDGET_CLOSE}`;
  return activity ? `${activity}\n\n${wrapped}` : wrapped;
}
