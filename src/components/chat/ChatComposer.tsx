import { useMemo, useRef } from "react";
import { estimateContextTokens } from "../../ai/estimateTokens";
import { contextWindowForModel, type AiModelOption } from "../../ai/types";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useChatStore } from "../../store/chatStore";
import { ChatContextMeter } from "./ChatContextMeter";
import { ChatModelPicker } from "./ChatModelPicker";

export function ChatComposer() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const modelId = useChatStore((s) => s.modelId);
  const setModelId = useChatStore((s) => s.setModelId);
  const status = useChatStore((s) => s.status);
  const messages = useChatStore((s) => s.messages);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const systemPromptPreview = useChatStore((s) => s.systemPromptPreview);
  const settings = useAiSettingsStore((s) => s.settings);

  const streaming = status === "streaming";
  const models: AiModelOption[] = settings.models.length
    ? settings.models
    : [];

  const modelOptions = useMemo(() => {
    if (!modelId || models.some((m) => m.id === modelId)) return models;
    return [
      {
        id: modelId,
        label: modelId,
        vendor: "openai" as const,
        kind: "chat" as const,
      },
      ...models,
    ];
  }, [models, modelId]);

  const used = useMemo(
    () =>
      estimateContextTokens({
        system: systemPromptPreview(),
        messages,
        draft,
        toolOverhead: mode === "agent" ? 1200 : 900,
      }),
    [messages, draft, mode, systemPromptPreview],
  );

  const limit = contextWindowForModel(settings, modelId || settings.modelId);

  const focusInput = () => {
    queueMicrotask(() => inputRef.current?.focus());
  };

  const handleSend = () => {
    if (streaming || !draft.trim()) return;
    void send();
    focusInput();
  };

  return (
    <div className="chat-composer">
      <textarea
        ref={inputRef}
        className="chat-composer-input"
        rows={2}
        placeholder={streaming ? "Streaming…" : "Message…"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <div className="chat-composer-toolbar">
        <div className="chat-mode-switch" role="group" aria-label="Chat mode">
          <button
            type="button"
            className={mode === "ask" ? "is-active" : ""}
            onClick={() => setMode("ask")}
            disabled={streaming}
          >
            Ask
          </button>
          <button
            type="button"
            className={mode === "agent" ? "is-active" : ""}
            onClick={() => setMode("agent")}
            disabled={streaming}
          >
            Agent
          </button>
        </div>

        <ChatModelPicker
          models={modelOptions}
          value={modelId}
          disabled={streaming}
          onChange={setModelId}
        />

        <ChatContextMeter used={used} limit={limit} />

        <div className="chat-composer-spacer" />

        {streaming ? (
          <button
            type="button"
            className="chat-send-btn is-stop"
            onClick={() => {
              stop();
              focusInput();
            }}
            title="Stop"
            aria-label="Stop"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="2" y="2" width="8" height="8" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!draft.trim()}
            title="Send"
            aria-label="Send"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M1.5 1.5l13 6.5-13 6.5V9.5L10 8 1.5 6.5V1.5z"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
