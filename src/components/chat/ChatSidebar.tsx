import { useEffect } from "react";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useChatStore } from "../../store/chatStore";
import { usePrefsStore } from "../../store/prefsStore";
import { useVaultStore } from "../../store/vaultStore";
import { ChatComposer } from "./ChatComposer";
import { ChatMessages } from "./ChatMessages";
import { ChatTabBar } from "./ChatTabBar";

export function ChatSidebar() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const hydrateForVault = useChatStore((s) => s.hydrateForVault);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const openTabIds = useChatStore((s) => s.openTabIds);
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const newThread = useChatStore((s) => s.newThread);
  const apiKey = useAiSettingsStore((s) => s.settings.apiKey);
  const openSettings = usePrefsStore((s) => s.openSettings);

  useEffect(() => {
    void hydrateForVault(vaultPath);
  }, [vaultPath, hydrateForVault]);

  const hasOpenTabs = openTabIds.length > 0 && !!activeThreadId;

  return (
    <aside className="chat-panel">
      <ChatTabBar />

      {!vaultPath ? (
        <div className="chat-empty-state">
          <p>Open a vault to start chatting.</p>
        </div>
      ) : !apiKey.trim() ? (
        <div className="chat-empty-state">
          <p>Add an API key to use AI chat.</p>
          <button
            type="button"
            className="chat-settings-link"
            onClick={() => openSettings("ai")}
          >
            Open AI settings
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
          <ChatMessages
            messages={messages}
            streaming={status === "streaming"}
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
          <ChatComposer />
        </>
      )}
    </aside>
  );
}
