import { useVaultStore, tabLabel, type EditorTab } from "../store/vaultStore";
import { useChatUiStore } from "../store/chatUiStore";

function TabItem({ tab }: { tab: EditorTab }) {
  const activePath = useVaultStore((s) => s.activePath);
  const openNote = useVaultStore((s) => s.openNote);
  const pinTab = useVaultStore((s) => s.pinTab);
  const closeTab = useVaultStore((s) => s.closeTab);

  const active = activePath === tab.path;

  return (
    <div
      className={[
        "editor-tab",
        active ? "is-active" : "",
        tab.preview ? "is-preview" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={tab.path}
      onMouseDown={(e) => {
        if (e.detail > 1) e.preventDefault();
      }}
      onClick={() => void openNote(tab.path, { preview: tab.preview })}
      onDoubleClick={(e) => {
        e.preventDefault();
        pinTab(tab.path);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          void closeTab(tab.path);
        }
      }}
      role="tab"
      aria-selected={active}
    >
      <span className="editor-tab-label">{tabLabel(tab.path)}</span>
      <button
        type="button"
        className="editor-tab-close"
        title="Close"
        aria-label={`Close ${tabLabel(tab.path)}`}
        onClick={(e) => {
          e.stopPropagation();
          void closeTab(tab.path);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"
          />
        </svg>
      </button>
    </div>
  );
}

export function EditorChrome() {
  const tabs = useVaultStore((s) => s.tabs);
  const chatOpen = useChatUiStore((s) => s.open);
  const toggleChat = useChatUiStore((s) => s.toggle);

  return (
    <div className="editor-chrome">
      <div className="editor-tabbar" role="tablist">
        {tabs.map((tab) => (
          <TabItem key={tab.path} tab={tab} />
        ))}
      </div>
      <button
        type="button"
        className={chatOpen ? "chat-toggle-btn is-active" : "chat-toggle-btn"}
        title={chatOpen ? "Hide chat" : "Show chat"}
        aria-label={chatOpen ? "Hide chat" : "Show chat"}
        aria-pressed={chatOpen}
        onClick={() => toggleChat()}
      >
        {/* vscode-codicons: layout-sidebar-right / layout-sidebar-right-off */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          {chatOpen ? (
            <path d="M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM9 14V2H3.5C2.672 2 2 2.672 2 3.5V12.5C2 13.328 2.672 14 3.5 14H9Z" />
          ) : (
            <path d="M12.5 1H3.5C2.122 1 1 2.122 1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.122 13.878 1 12.5 1ZM2 12.5V3.5C2 2.673 2.673 2 3.5 2H9V14H3.5C2.673 14 2 13.327 2 12.5ZM14 12.5C14 13.327 13.327 14 12.5 14H10V2H12.5C13.327 2 14 2.673 14 3.5V12.5Z" />
          )}
        </svg>
      </button>
    </div>
  );
}

/** @deprecated use EditorChrome */
export function TabBar() {
  return <EditorChrome />;
}
