import { memo, useSyncExternalStore } from "react";
import {
  allowAllPendingTerminal,
  listPendingTerminalApprovals,
  resolveTerminalApproval,
  subscribeTerminalApprovals,
  type TerminalApprovalRequest,
} from "../../ai/terminalTool";
import { useChatStore } from "../../store/chatStore";

function subscribe(cb: () => void) {
  return subscribeTerminalApprovals(cb);
}

function snapshot(): TerminalApprovalRequest[] {
  return listPendingTerminalApprovals();
}

function ChatTerminalApprovalBarInner() {
  const pending = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setTerminalAllowForChat = useChatStore((s) => s.setTerminalAllowForChat);

  if (pending.length === 0) return null;

  return (
    <div className="chat-terminal-approval" role="region" aria-label="Terminal approval">
      {pending.map((item) => (
        <div key={item.toolCallId} className="chat-terminal-approval-item">
          <div className="chat-terminal-approval-kicker">Run this command?</div>
          {item.cwd ? (
            <div className="chat-terminal-approval-cwd" title={item.cwd}>
              {item.cwd}
            </div>
          ) : (
            <div className="chat-terminal-approval-cwd">vault root</div>
          )}
          <pre className="chat-terminal-approval-cmd">{item.command}</pre>
          <div className="chat-terminal-approval-actions">
            <button
              type="button"
              className="chat-terminal-approval-deny"
              onClick={() => resolveTerminalApproval(item.toolCallId, "deny")}
            >
              Deny
            </button>
            <button
              type="button"
              className="chat-terminal-approval-allow-chat"
              onClick={() => {
                allowAllPendingTerminal();
                setTerminalAllowForChat(true);
              }}
            >
              Allow for this chat
            </button>
            <button
              type="button"
              className="chat-terminal-approval-allow"
              onClick={() => resolveTerminalApproval(item.toolCallId, "allow")}
            >
              Allow
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export const ChatTerminalApprovalBar = memo(ChatTerminalApprovalBarInner);
