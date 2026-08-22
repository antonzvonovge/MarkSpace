import { useChatStore } from "../../store/chatStore";
import { useIeltsUiStore } from "../../store/ieltsUiStore";

export function ChatIeltsBar() {
  const session = useIeltsUiStore((s) => s.session);
  const threadId = useChatStore((s) => s.activeThreadId);
  const patch = useIeltsUiStore((s) => s.patch);
  const send = useChatStore((s) => s.send);

  if (!session || session.threadId !== threadId) return null;

  const skill =
    session.skill[0]!.toUpperCase() + session.skill.slice(1);

  return (
    <div className="chat-ielts-bar">
      <span className="chat-ielts-bar-skill">IELTS {skill}</span>
      <span className="chat-ielts-bar-folder" title={session.folder}>
        {session.folder}
      </span>
      {session.skill === "speaking" ? (
        <button
          type="button"
          className="chat-ielts-bar-btn"
          onClick={() => patch({ muteExaminer: !session.muteExaminer })}
        >
          {session.muteExaminer ? "Unmute examiner" : "Mute examiner"}
        </button>
      ) : null}
      {session.skill === "speaking" && session.awaitingSubmit ? (
        <button
          type="button"
          className="chat-ielts-bar-btn is-submit"
          title="Ask the examiner to score this session and save a note"
          onClick={() => {
            void send(
              "End session. Please grade my speaking and save the session note.",
            );
          }}
        >
          End session
        </button>
      ) : null}
    </div>
  );
}
