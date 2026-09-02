import { memo, useEffect } from "react";
import { hasAnyLlmCredentials } from "../../ai/languageModel";
import { useAgentMemoryStore } from "../../store/agentMemoryStore";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useChatStore } from "../../store/chatStore";
import { useDiarySettingsStore } from "../../store/diarySettingsStore";
import { useIndexingSettingsStore } from "../../store/indexingSettingsStore";
import { useVaultAiSettingsStore } from "../../store/vaultAiSettingsStore";
import { useVaultAppearanceStore } from "../../store/vaultAppearanceStore";
import { usePrefsStore } from "../../store/prefsStore";
import { useVaultStore } from "../../store/vaultStore";
import { ChatComposer } from "./ChatComposer";
import { ChatGemBanner } from "./ChatGemBanner";
import { ChatMessages } from "./ChatMessages";
import { ChatTabBar } from "./ChatTabBar";
import { ChatTerminalApprovalBar } from "./ChatTerminalApprovalBar";

export const ChatSidebar = memo(function ChatSidebar() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const hydrateForVault = useChatStore((s) => s.hydrateForVault);
  const hydrateMemory = useAgentMemoryStore((s) => s.hydrateForVault);
  const hydrateDiary = useDiarySettingsStore((s) => s.hydrateForVault);
  const hydrateIndexing = useIndexingSettingsStore((s) => s.hydrateForVault);
  const hydrateVaultAi = useVaultAiSettingsStore((s) => s.hydrateForVault);
  const hydrateAppearance = useVaultAppearanceStore((s) => s.hydrateForVault);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const openTabIds = useChatStore((s) => s.openTabIds);
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const newThread = useChatStore((s) => s.newThread);
  const settings = useAiSettingsStore((s) => s.settings);
  const openSettings = usePrefsStore((s) => s.openSettings);
  const hasCredentials = hasAnyLlmCredentials(settings);

  useEffect(() => {
    void hydrateForVault(vaultPath);
    void hydrateMemory(vaultPath);
    void hydrateDiary(vaultPath);
    void hydrateIndexing(vaultPath);
    void hydrateVaultAi(vaultPath);
    void hydrateAppearance(vaultPath);
  }, [
    vaultPath,
    hydrateForVault,
    hydrateMemory,
    hydrateDiary,
    hydrateIndexing,
    hydrateVaultAi,
    hydrateAppearance,
  ]);

  const hasOpenTabs = openTabIds.length > 0 && !!activeThreadId;
  const composerAtTop = hasOpenTabs && messages.length === 0;

  return (
    <aside className={composerAtTop ? "chat-panel is-composer-top" : "chat-panel"}>
      <ChatTabBar />

      {!vaultPath ? (
        <div className="chat-empty-state">
          <p>Open a vault to start chatting.</p>
        </div>
      ) : !hasCredentials ? (
        <div className="chat-empty-state">
          <p>
            Add a Google or OpenAI-compatible gateway key to use AI chat.
          </p>
          <button
            type="button"
            className="chat-settings-link"
            onClick={() => openSettings("keys")}
          >
            Open API keys
          </button>
        </div>
      ) : !hasOpenTabs ? (
        <div className="chat-empty-state">
          <p>No open chats</p>
          <button
            type="button"
            className="chat-settings-link"
            onClick={() => void newThread()}
          >
            New chat
          </button>
        </div>
      ) : (
        <>
          <ChatGemBanner />
          {composerAtTop && <ChatComposer />}
          <ChatMessages
            messages={messages}
            streaming={status === "streaming" || status === "compacting"}
            compacting={status === "compacting"}
          />
          {error && (
            <div className="chat-error" role="alert">
              <div className="chat-error-text">{error}</div>
              <button
                type="button"
                className="chat-error-dismiss"
                onClick={() => useChatStore.getState().clearError()}
              >
                Dismiss
              </button>
            </div>
          )}
          <ChatTerminalApprovalBar />
          {!composerAtTop && <ChatComposer />}
        </>
      )}
    </aside>
  );
});
