import { isToolUIPart, type UIMessage } from "ai";
import { parseIeltsPaperInput } from "../../ai/ieltsPaper";
import { ChatIeltsAudio } from "./ChatIeltsAudio";
import { ChatIeltsPaper } from "./ChatIeltsPaper";
import { ChatToolCall } from "./ChatToolCall";

type Props = {
  part: UIMessage["parts"][number];
};

function outputOf(part: UIMessage["parts"][number]): unknown {
  if ("output" in part) return part.output;
  return undefined;
}

function actionOf(part: UIMessage["parts"][number]): string | undefined {
  const input = "input" in part ? part.input : undefined;
  if (input && typeof input === "object" && "action" in input) {
    const a = (input as { action?: unknown }).action;
    if (typeof a === "string") return a;
  }
  const output = outputOf(part);
  if (output && typeof output === "object" && "action" in output) {
    const a = (output as { action?: unknown }).action;
    if (typeof a === "string") return a;
  }
  return undefined;
}

export function ChatIeltsPractice({ part }: Props) {
  if (!isToolUIPart(part)) return null;
  if (parseIeltsPaperInput("input" in part ? part.input : undefined)) {
    return <ChatIeltsPaper part={part} />;
  }
  if (actionOf(part) === "show_paper") {
    return <ChatIeltsPaper part={part} />;
  }
  const output = outputOf(part) as
    | {
        action?: string;
        paths?: string[];
        path?: string;
        ok?: boolean;
        error?: string;
      }
    | undefined;
  const paths = Array.isArray(output?.paths) ? output.paths : [];
  if (paths.length > 0) {
    return (
      <ChatIeltsAudio paths={paths} />
    );
  }
  if (output?.action === "set_secret") {
    return (
      <div className="chat-ielts-secret">
        Answer key is hidden. Fill the paper when it appears, then Submit.
      </div>
    );
  }
  if (output?.action === "grade") {
    return (
      <div className="chat-ielts-secret">Comparing with the hidden key…</div>
    );
  }
  if (output?.action === "save_note" && output.path) {
    return (
      <div className="chat-ielts-saved">
        Session note saved: {output.path}
      </div>
    );
  }
  return <ChatToolCall part={part} />;
}
