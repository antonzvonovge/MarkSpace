import type { UIMessage } from "ai";

/**
 * Keep the last `limit` user turns. One turn = one user message plus every
 * following assistant message (reasoning, tools, text) until the next user.
 */
export function sliceToRecentUserTurns(
  messages: UIMessage[],
  limit: number,
): UIMessage[] {
  const cap = Math.floor(limit);
  if (cap <= 0 || messages.length === 0) return messages;

  const userStarts: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user") userStarts.push(index);
  });
  if (userStarts.length <= cap) return messages;

  return messages.slice(userStarts[userStarts.length - cap]!);
}

/** Apply gem turn cap when configured; otherwise return messages unchanged. */
export function applyRecentUserTurnLimit(
  messages: UIMessage[],
  recentUserTurns: number | null | undefined,
): UIMessage[] {
  if (recentUserTurns == null) return messages;
  return sliceToRecentUserTurns(messages, recentUserTurns);
}
