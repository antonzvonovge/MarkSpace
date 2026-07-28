import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError } from "@ai-sdk/provider";
import {
  convertToModelMessages,
  isReasoningUIPart,
  isTextUIPart,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { modelSupportsReasoning } from "./models";
import { resolveModelId } from "./resolveModelId";
import type { ChatMode } from "./types";
import { buildSystemPrompt, buildVaultTools } from "./vaultTools";

export type RunChatParams = {
  messages: UIMessage[];
  mode: ChatMode;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  vaultPath: string | null;
  activePath: string | null;
  activeExcerpt: string | null;
  abortSignal?: AbortSignal;
  onMessages: (messages: UIMessage[]) => void;
};

type AssistantPart = UIMessage["parts"][number];

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

  const emit = () => {
    params.onMessages([
      ...inputMessages,
      { id: assistantId, role: "assistant", parts: [...parts] },
    ]);
  };

  emit();

  const modelId = resolveModelId(params.baseUrl, params.modelId);
  const wantsReasoning = modelSupportsReasoning(modelId);

  const openrouter = createOpenRouter({
    apiKey: params.apiKey,
    compatibility: "strict",
    headers: {
      "HTTP-Referer": "https://markspace.app",
      "X-Title": "MarkSpace",
    },
  });

  const system = buildSystemPrompt({
    mode: params.mode,
    vaultPath: params.vaultPath,
    activePath: params.activePath,
    activeExcerpt: params.activeExcerpt,
  });

  const tools = buildVaultTools(params.mode);
  const modelMessages = await convertToModelMessages(inputMessages);

  const result = streamText({
    model: openrouter(modelId),
    system,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(12),
    abortSignal: params.abortSignal,
    ...(wantsReasoning
      ? {
          providerOptions: {
            openrouter: {
              reasoning: {
                effort: "medium" as const,
                exclude: false,
              },
            },
          },
        }
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
          emit();
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
          }
          const current = parts[idx];
          if (current && isReasoningUIPart(current)) {
            parts[idx] = {
              type: "reasoning",
              text: current.text + part.text,
              state: "streaming",
              providerMetadata: part.providerMetadata ?? current.providerMetadata,
            };
            emit();
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
              emit();
            }
          }
          break;
        }
        case "text-start": {
          const idx = parts.length;
          textIndex.set(part.id, idx);
          parts.push({ type: "text", text: "" });
          emit();
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
          emit();
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
          emit();
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
          emit();
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
      emit();
      return [
        ...inputMessages,
        { id: assistantId, role: "assistant", parts: [...parts] },
      ];
    }
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
  params.onMessages(finalMessages);
  return finalMessages;
}
