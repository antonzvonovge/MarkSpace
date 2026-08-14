import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getChatThreadPath } from "../../lib/chatHistoryApi";
import { writeClipboardText } from "../../lib/clipboardText";
import { useChatStore } from "../../store/chatStore";
import { useVaultStore } from "../../store/vaultStore";
import { useHorizontalWheelScroll } from "../../hooks/useHorizontalWheelScroll";
import { useTabReorder } from "../../hooks/useTabReorder";
import {
  TabContextMenu,
  type TabContextMenuState,
} from "../TabContextMenu";
import { CloseIcon } from "../treeIcons";
import { ChatHistoryMenu } from "./ChatHistoryMenu";
import { ChatGemsMenu } from "./ChatGemsMenu";
import { ChatGemIcon } from "./ChatGemIcon";

export function ChatTabBar() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const threads = useChatStore((s) => s.threads);
  const openTabIds = useChatStore((s) => s.openTabIds);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const activeProjectPath = useChatStore((s) => s.projectPath);
  const attentionThreadIds = useChatStore((s) => s.attentionThreadIds);
  const selectThread = useChatStore((s) => s.selectThread);
  const closeTab = useChatStore((s) => s.closeTab);
  const closeOtherTabs = useChatStore((s) => s.closeOtherTabs);
  const closeTabsToTheRight = useChatStore((s) => s.closeTabsToTheRight);
  const reorderOpenTabs = useChatStore((s) => s.reorderOpenTabs);
  const newThread = useChatStore((s) => s.newThread);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(
    null,
  );
  const activeRef = useRef<HTMLDivElement>(null);
  const tabbarRef = useHorizontalWheelScroll<HTMLDivElement>();

  const tabs = useMemo(() => {
    const byId = new Map(threads.map((t) => [t.id, t]));
    return openTabIds
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t);
  }, [threads, openTabIds]);

  const attentionSet = useMemo(
    () => new Set(attentionThreadIds),
    [attentionThreadIds],
  );

  const onReorder = useCallback(
    (from: number, to: number) => {
      void reorderOpenTabs(from, to);
    },
    [reorderOpenTabs],
  );
  const bindReorder = useTabReorder(tabs.length, onReorder);

  const copyThreadPath = useCallback(
    async (threadId: string) => {
      if (!vaultPath) return;
      try {
        const path = await getChatThreadPath(vaultPath, threadId);
        await writeClipboardText(path);
      } catch (err) {
        console.warn("copy chat thread path failed", err);
      }
    },
    [vaultPath],
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeThreadId]);

  return (
    <div className="chat-chrome">
      <div
        ref={tabbarRef}
        className="editor-tabbar chat-tabbar"
        role="tablist"
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeThreadId;
          const attention = attentionSet.has(tab.id);
          const reorder = bindReorder(index);
          const projectPath =
            (
              (active ? activeProjectPath : null) ||
              tab.projectPath ||
              ""
            ).trim() || "";
          const projectColor = projectPath
            ? (projectPropertiesByPath[projectPath]?.color ?? "")
            : "";
          return (
            <div
              key={tab.id}
              ref={active ? activeRef : undefined}
              className={[
                "editor-tab",
                active ? "is-active" : "",
                attention ? "has-attention" : "",
                projectColor ? "has-project-color" : "",
                reorder.className,
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                projectColor
                  ? ({
                      ["--tab-project-color"]: projectColor,
                    } as CSSProperties)
                  : undefined
              }
              title={tab.title}
              role="tab"
              aria-selected={active}
              draggable={reorder.draggable}
              onDragStart={reorder.onDragStart}
              onDragEnd={reorder.onDragEnd}
              onDragOver={reorder.onDragOver}
              onDragLeave={reorder.onDragLeave}
              onDrop={reorder.onDrop}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                if ((e.target as HTMLElement).closest(".editor-tab-close")) return;
                // Activate on press so HTML5 DnD does not eat the click.
                if (e.detail > 1) e.preventDefault();
                void selectThread(tab.id);
              }}
              onClick={() => {
                // Swallow only the spurious post-drop click; activation is on mousedown.
                reorder.shouldIgnoreClick();
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void closeTab(tab.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  targetId: tab.id,
                  index,
                  tabCount: tabs.length,
                });
              }}
            >
              {attention ? (
                <span
                  className="chat-tab-attention"
                  title="Agent finished"
                  aria-label="Agent finished"
                />
              ) : null}
              {tab.gemId ? (
                <span
                  className="chat-tab-gem"
                  title="Gem chat"
                  aria-label="Gem chat"
                >
                  <ChatGemIcon size={12} />
                </span>
              ) : null}
              <span className="editor-tab-label">{tab.title}</span>
              <button
                type="button"
                className="editor-tab-close"
                title="Close"
                aria-label={`Close ${tab.title}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(tab.id);
                }}
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>

      <div className="chat-chrome-actions">
        <div className="chat-history-wrap">
          <button
            type="button"
            className={historyOpen ? "chat-icon-btn is-active" : "chat-icon-btn"}
            title="History"
            aria-label="Chat history"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
            disabled={!vaultPath}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 3a5 5 0 110 10A5 5 0 018 3zm.75 2v3.19l2.28 1.32-.75 1.3L7.25 9V5h1.5z"
              />
            </svg>
          </button>
          <ChatHistoryMenu
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
          />
        </div>
        <ChatGemsMenu />
        <button
          type="button"
          className="chat-icon-btn"
          title="New chat"
          aria-label="New chat"
          onClick={() => void newThread()}
          disabled={!vaultPath}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 2.5a.75.75 0 01.75.75v4h4a.75.75 0 010 1.5h-4v4a.75.75 0 01-1.5 0v-4h-4a.75.75 0 010-1.5h4v-4A.75.75 0 018 2.5z"
            />
          </svg>
        </button>
      </div>
      {contextMenu ? (
        <TabContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onCopyPath={() => void copyThreadPath(contextMenu.targetId)}
          onCloseTab={() => void closeTab(contextMenu.targetId)}
          onCloseOthers={() => void closeOtherTabs(contextMenu.targetId)}
          onCloseToTheRight={() =>
            void closeTabsToTheRight(contextMenu.targetId)
          }
        />
      ) : null}
    </div>
  );
}
