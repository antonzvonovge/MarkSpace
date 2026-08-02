import { APICallError } from "@ai-sdk/provider";
import {
  convertToModelMessages,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import {
  resolveLanguageModel,
  type AiProviderCredentials,
} from "./languageModel";
import type { LoadedSkill, SkillMeta } from "./skills";
import type { ChatMode } from "./types";
import { buildSystemPrompt, buildVaultTools } from "./vaultTools";

export type RunChatParams = {
  messages: UIMessage[];
  mode: ChatMode;
  modelId: string;
  keys: AiProviderCredentials;
  vaultPath: string | null;
  activePath: string | null;
  activeExcerpt: string | null;
  projectPath?: string | null;
  projectAbout?: string | null;
  skills?: SkillMeta[] | null;
  forcedSkills?: LoadedSkill[] | null;
  forcedTools?: string[] | null;
  abortSignal?: AbortSignal;
  onMessages: (messages: UIMessage[]) => void;
  /**
   * Live thinking text without rewriting `messages` (avoids full chat re-renders).
   * Pass `null` when reasoning ends or is cleared.
   */
  onReasoningPreview?: (text: string | null) => void;
};

type AssistantPart = UIMessage["parts"][number];

/** Cap tool payloads in live UI state; full data stays in `parts` for the final message. */
const UI_TOOL_STRING_CAP = 480;

function slimJsonValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length <= UI_TOOL_STRING_CAP) return value;
    return `${value.slice(0, UI_TOOL_STRING_CAP)}…[+${(
      value.length - UI_TOOL_STRING_CAP
    ).toLocaleString()} chars]`;
  }
  if (typeof value !== "object") return value;
  if (depth > 5) return "…";
  if (Array.isArray(value)) {
    const head = value
      .slice(0, 30)
      .map((item) => slimJsonValue(item, depth + 1));
    if (value.length > 30) head.push(`…+${value.length - 30} items`);
    return head;
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    out[key] = slimJsonValue(nested, depth + 1);
  }
  return out;
}

function slimToolPart(part: AssistantPart): AssistantPart {
  if (!isToolUIPart(part)) return part;
  const next = { ...part } as AssistantPart & {
    input?: unknown;
    output?: unknown;
  };
  if ("input" in part) next.input = slimJsonValue(part.input);
  if ("output" in part) next.output = slimJsonValue(part.output);
  return next;
}

export function formatAiError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const bits = [`HTTP ${error.statusCode ?? "?"}: ${error.message}`];
    if (error.responseBody && error.responseBody.length < 800) {
      bits.push(error.responseBody.trim());
    }
    return bits.join("\n");
  }
  if (error instanceof Error) {
    const withCause = error as Error & { cause?: unknown };
    if (withCause.cause instanceof Error && withCause.cause.message) {
      return `${error.message} (${withCause.cause.message})`;
    }
    return error.message || String(error);
  }
  return String(error);
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /abort/i.test(error.message);
}

export async function runChat(params: RunChatParams): Promise<UIMessage[]> {
  const inputMessages = params.messages;
  const assistantId = crypto.randomUUID();
  const parts: AssistantPart[] = [];
  const reasoningIndex = new Map<string, number>();
  const textIndex = new Map<string, number>();
  /** Avoid re-slimming huge tool payloads on every text-delta frame. */
  const slimToolByCallId = new Map<string, AssistantPart>();

  /** High-frequency text deltas coalesce to one UI update per animation frame. */
  let emitScheduled = false;
  let emitRaf = 0;
  /** Reasoning preview is throttled separately — never pushes into `messages`. */
  let reasoningPreviewTimer = 0;
  let reasoningPreviewPending: string | null = null;

  const partsForLiveUi = (): AssistantPart[] =>
    parts.map((part) => {
      if (!isToolUIPart(part)) return part;
      const callId =
        "toolCallId" in part && typeof part.toolCallId === "string"
          ? part.toolCallId
          : "";
      const state = "state" in part ? String(part.state) : "";
      const cacheKey = `${callId}:${state}`;
      const cached = slimToolByCallId.get(cacheKey);
      if (cached) return cached;
      const slimmed = slimToolPart(part);
      // Drop older states for this call id.
      for (const key of slimToolByCallId.keys()) {
        if (key.startsWith(`${callId}:`)) slimToolByCallId.delete(key);
      }
      slimToolByCallId.set(cacheKey, slimmed);
      return slimmed;
    });

  const flush = () => {
    emitScheduled = false;
    if (emitRaf) {
      cancelAnimationFrame(emitRaf);
      emitRaf = 0;
    }
    // Slim tool I/O in live UI updates — full payloads only in the final message.
    params.onMessages([
      ...inputMessages,
      {
        id: assistantId,
        role: "assistant",
        parts: partsForLiveUi(),
      },
    ]);
  };

  const emit = (immediate = false) => {
    if (immediate) {
      flush();
      return;
    }
    if (emitScheduled) return;
    emitScheduled = true;
    emitRaf = requestAnimationFrame(() => {
      emitRaf = 0;
      flush();
    });
  };

  const flushReasoningPreview = () => {
    if (reasoningPreviewTimer) {
      clearTimeout(reasoningPreviewTimer);
      reasoningPreviewTimer = 0;
    }
    if (reasoningPreviewPending === null) return;
    const text = reasoningPreviewPending;
    reasoningPreviewPending = null;
    params.onReasoningPreview?.(text);
  };

  const previewReasoning = (text: string, immediate = false) => {
    if (!params.onReasoningPreview) return;
    if (immediate) {
      reasoningPreviewPending = null;
      if (reasoningPreviewTimer) {
        clearTimeout(reasoningPreviewTimer);
        reasoningPreviewTimer = 0;
      }
      params.onReasoningPreview(text);
      return;
    }
    reasoningPreviewPending = text;
    if (reasoningPreviewTimer) return;
    reasoningPreviewTimer = window.setTimeout(() => {
      reasoningPreviewTimer = 0;
      flushReasoningPreview();
    }, 120);
  };

  const clearReasoningPreview = () => {
    reasoningPreviewPending = null;
    if (reasoningPreviewTimer) {
      clearTimeout(reasoningPreviewTimer);
      reasoningPreviewTimer = 0;
    }
    params.onReasoningPreview?.(null);
  };

  emit(true);

  const resolved = resolveLanguageModel({
    modelId: params.modelId,
    keys: params.keys,
  });

  const system = buildSystemPrompt({
    mode: params.mode,
    vaultPath: params.vaultPath,
    activePath: params.activePath,
    activeExcerpt: params.activeExcerpt,
    projectPath: params.projectPath,
    projectAbout: params.projectAbout,
    skills: params.skills,
    forcedSkills: params.forcedSkills,
    forcedTools: params.forcedTools,
  });

  const tools = buildVaultTools(params.mode, {
    getMessages: () => inputMessages,
    projectPath: params.projectPath,
  });
  const modelMessages = await convertToModelMessages(inputMessages, { tools });

  const result = streamText({
    model: resolved.model,
    system,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(12),
    abortSignal: params.abortSignal,
    ...(resolved.providerOptions
      ? { providerOptions: resolved.providerOptions }
      : {}),
  });

  try {
    for await (const part of result.fullStream) {
      if (params.abortSignal?.aborted) break;

      switch (part.type) {
        case "reasoning-start": {
          const idx = parts.length;
          reasoningIndex.set(part.id, idx);
          parts.push({
            type: "reasoning",
            text: "",
            state: "streaming",
            providerMetadata: part.providerMetadata,
          });
          previewReasoning("", true);
          emit(true);
          break;
        }
        case "reasoning-delta": {
          let idx = reasoningIndex.get(part.id);
          if (idx === undefined) {
            idx = parts.length;
            reasoningIndex.set(part.id, idx);
            parts.push({
              type: "reasoning",
              text: "",
              state: "streaming",
            });
            previewReasoning("", true);
            emit(true);
          }
          const current = parts[idx];
          if (current && isReasoningUIPart(current)) {
            const nextText = current.text + part.text;
            parts[idx] = {
              type: "reasoning",
              text: nextText,
              state: "streaming",
              providerMetadata: part.providerMetadata ?? current.providerMetadata,
            };
            // Keep thinking out of `messages` until end — only update light preview.
            previewReasoning(nextText);
          }
          break;
        }
        case "reasoning-end": {
          const idx = reasoningIndex.get(part.id);
          if (idx !== undefined) {
            const current = parts[idx];
            if (current && isReasoningUIPart(current)) {
              parts[idx] = {
                type: "reasoning",
                text: current.text,
                state: "done",
                providerMetadata:
                  part.providerMetadata ?? current.providerMetadata,
              };
              clearReasoningPreview();
              emit(true);
            }
          }
          break;
        }
        case "text-start": {
          const idx = parts.length;
          textIndex.set(part.id, idx);
          parts.push({ type: "text", text: "" });
          emit(true);
          break;
        }
        case "text-delta": {
          let idx = textIndex.get(part.id);
          if (idx === undefined) {
            idx = -1;
            for (let i = parts.length - 1; i >= 0; i--) {
              if (isTextUIPart(parts[i]!)) {
                idx = i;
                break;
              }
            }
            if (idx < 0) {
              idx = parts.length;
              parts.push({ type: "text", text: "" });
            }
            textIndex.set(part.id, idx);
          }
          const current = parts[idx];
          if (current && isTextUIPart(current)) {
            parts[idx] = { type: "text", text: current.text + part.text };
            emit();
          }
          break;
        }
        case "text-end": {
          break;
        }
        case "tool-call": {
          parts.push({
            type: `tool-${part.toolName}`,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            state: "input-available",
            input: part.input,
          } as AssistantPart);
          emit(true);
          break;
        }
        case "tool-result": {
          const idx = parts.findIndex(
            (p) =>
              "toolCallId" in p &&
              (p as { toolCallId?: string }).toolCallId === part.toolCallId,
          );
          const toolPart = {
            type: `tool-${part.toolName}`,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            state: "output-available",
            input: part.input,
            output: part.output,
          } as AssistantPart;
          if (idx >= 0) parts[idx] = toolPart;
          else parts.push(toolPart);
          emit(true);
          break;
        }
        case "tool-error": {
          const idx = parts.findIndex(
            (p) =>
              "toolCallId" in p &&
              (p as { toolCallId?: string }).toolCallId === part.toolCallId,
          );
          const toolPart = {
            type: `tool-${part.toolName}`,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            state: "output-error",
            input: part.input,
            errorText: formatAiError(part.error),
          } as AssistantPart;
          if (idx >= 0) parts[idx] = toolPart;
          else parts.push(toolPart);
          emit(true);
          break;
        }
        case "error": {
          throw part.error;
        }
        default:
          break;
      }
    }
  } catch (error) {
    if (isAbortError(error, params.abortSignal)) {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p && isReasoningUIPart(p) && p.state === "streaming") {
          parts[i] = { ...p, state: "done" };
        }
      }
      clearReasoningPreview();
      emit(true);
      return [
        ...inputMessages,
        { id: assistantId, role: "assistant", parts: [...parts] },
      ];
    }
    clearReasoningPreview();
    throw error instanceof Error ? error : new Error(formatAiError(error));
  }

  try {
    await result.text;
  } catch (error) {
    if (!isAbortError(error, params.abortSignal)) {
      throw error instanceof Error ? error : new Error(formatAiError(error));
    }
  }

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p && isReasoningUIPart(p) && p.state === "streaming") {
      parts[i] = { ...p, state: "done" };
    }
  }

  const cleaned = parts.filter((p) => {
    if (isTextUIPart(p)) return p.text.trim().length > 0;
    if (isReasoningUIPart(p)) return p.text.trim().length > 0;
    return true;
  });

  const finalMessages: UIMessage[] = [
    ...inputMessages,
    { id: assistantId, role: "assistant", parts: cleaned },
  ];
  if (emitRaf) {
    cancelAnimationFrame(emitRaf);
    emitRaf = 0;
    emitScheduled = false;
  }
  clearReasoningPreview();
  params.onMessages(finalMessages);
  return finalMessages;
}
