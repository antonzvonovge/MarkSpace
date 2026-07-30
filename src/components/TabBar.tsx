import { useCallback } from "react";
import { useVaultStore, tabLabel, type EditorTab } from "../store/vaultStore";
import { useChatUiStore } from "../store/chatUiStore";
import { useFocusUiStore } from "../store/focusUiStore";
import { useSidebarUiStore } from "../store/sidebarUiStore";
import { useTabReorder } from "../hooks/useTabReorder";

function TabItem({
  tab,
  index,
  bindReorder,
}: {
  tab: EditorTab;
  index: number;
  bindReorder: ReturnType<typeof useTabReorder>;
}) {
  const activePath = useVaultStore((s) => s.activePath);
  const openNote = useVaultStore((s) => s.openNote);
  const pinTab = useVaultStore((s) => s.pinTab);
  const closeTab = useVaultStore((s) => s.closeTab);
  const reorder = bindReorder(index);

  const active = activePath === tab.path;

  return (
    <div
      className={[
        "editor-tab",
        active ? "is-active" : "",
        tab.preview ? "is-preview" : "",
        reorder.className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={tab.path}
      draggable={reorder.draggable}
      onDragStart={reorder.onDragStart}
      onDragEnd={reorder.onDragEnd}
      onDragOver={reorder.onDragOver}
      onDragLeave={reorder.onDragLeave}
      onDrop={reorder.onDrop}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest(".editor-tab-close")) return;
        // Activate on press (VS Code-style) so HTML5 DnD does not eat the click.
        if (e.detail > 1) e.preventDefault();
        void openNote(tab.path, { preview: tab.preview });
      }}
      onClick={() => {
        // Swallow only the spurious post-drop click; activation is on mousedown.
        reorder.shouldIgnoreClick();
      }}
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
        onMouseDown={(e) => e.stopPropagation()}
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
  const reorderTabs = useVaultStore((s) => s.reorderTabs);
  const sidebarOpen = useSidebarUiStore((s) => s.open);
  const toggleSidebar = useSidebarUiStore((s) => s.toggle);
  const chatOpen = useChatUiStore((s) => s.open);
  const toggleChat = useChatUiStore((s) => s.toggle);
  const focusActive = useFocusUiStore((s) => s.active);
  const toggleFocus = useFocusUiStore((s) => s.toggle);

  const onReorder = useCallback(
    (from: number, to: number) => {
      reorderTabs(from, to);
    },
    [reorderTabs],
  );
  const bindReorder = useTabReorder(tabs.length, onReorder);

  return (
    <div className="editor-chrome">
      <button
        type="button"
        className={
          sidebarOpen ? "sidebar-toggle-btn is-active" : "sidebar-toggle-btn"
        }
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        aria-pressed={sidebarOpen}
        disabled={focusActive}
        onClick={() => toggleSidebar()}
      >
        {/* vscode-codicons: layout-sidebar-left / layout-sidebar-left-off */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          {sidebarOpen ? (
            <path d="M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM12.5 14C13.328 14 14 13.328 14 12.5V3.5C14 2.672 13.328 2 12.5 2H7V14H12.5Z" />
          ) : (
            <path d="M1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.122 13.878 1 12.5 1H3.5C2.122 1 1 2.122 1 3.5ZM12.5 14H7V2H12.5C13.327 2 14 2.673 14 3.5V12.5C14 13.327 13.327 14 12.5 14ZM2 3.5C2 2.673 2.673 2 3.5 2H6V14H3.5C2.673 14 2 13.327 2 12.5V3.5Z" />
          )}
        </svg>
      </button>
      <div className="editor-tabbar" role="tablist">
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.path}
            tab={tab}
            index={index}
            bindReorder={bindReorder}
          />
        ))}
      </div>
      <button
        type="button"
        className={
          focusActive ? "focus-toggle-btn is-active" : "focus-toggle-btn"
        }
        title={focusActive ? "Restore panels" : "Expand editor"}
        aria-label={focusActive ? "Restore panels" : "Expand editor"}
        aria-pressed={focusActive}
        onClick={() => toggleFocus()}
      >
        {/* vscode-codicons: screen-full / screen-normal */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          {focusActive ? (
            <path d="M3.5 4H1V3h2V1h1v2.5l-.5.5zM13 3V1h-1v2.5l.5.5H15V3h-2zm-1 9.5V15h1v-2h2v-1h-2.5l-.5.5zM1 12v1h2v2h1v-2.5l-.5-.5H1zm11-1.5l-.5.5h-7l-.5-.5v-5l.5-.5h7l.5.5v5zM10 7H6v2h4V7z" />
          ) : (
            <path d="M3 12h10V4H3v8zm2-6h6v4H5V6zM2 6H1V2.5l.5-.5H5v1H2v3zm13-3.5V6h-1V3h-3V2h3.5l.5.5zM14 10h1v3.5l-.5.5H11v-1h3v-3zM2 13h3v1H1.5l-.5-.5V10h1v3z" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className={chatOpen ? "chat-toggle-btn is-active" : "chat-toggle-btn"}
        title={chatOpen ? "Hide chat" : "Show chat"}
        aria-label={chatOpen ? "Hide chat" : "Show chat"}
        aria-pressed={chatOpen}
        disabled={focusActive}
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
