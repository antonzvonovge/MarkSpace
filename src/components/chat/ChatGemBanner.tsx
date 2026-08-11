import { useChatStore } from "../../store/chatStore";
import { ChatGemIcon } from "./ChatGemIcon";

/** Top strip when the active chat is bound to a Gem. */
export function ChatGemBanner() {
  const gemId = useChatStore((s) => s.gemId);
  const gemName = useChatStore((s) => s.gemName);

  if (!gemId || !gemName.trim()) return null;

  return (
    <div className="chat-gem-banner" role="status">
      <ChatGemIcon size={14} />
      <span className="chat-gem-banner-text">
        Gem chat · <strong>{gemName.trim()}</strong>
      </span>
    </div>
  );
}
