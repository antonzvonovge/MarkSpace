import {
  contextSafetyMargin,
  formatTokenCount,
  wouldExceedContext,
} from "../../ai/estimateTokens";

type Props = {
  used: number;
  limit: number;
  /** When true, Send will compact older turns before the new message. */
  willCompactOnSend?: boolean;
};

function formatK(n: number): string {
  return formatTokenCount(Math.round(n));
}

export function ChatContextMeter({
  used,
  limit,
  willCompactOnSend = false,
}: Props) {
  const safeLimit = Math.max(1, limit);
  const margin = contextSafetyMargin(safeLimit);
  const remaining = Math.max(0, safeLimit - used);
  const ratio = Math.min(1, used / safeLimit);
  const blocked = wouldExceedContext(used, safeLimit);
  const r = 7;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - ratio);

  let tone: "ok" | "warn" | "danger" = "ok";
  if (blocked || remaining <= margin) tone = "danger";
  else if (remaining <= margin * 2) tone = "warn";

  const title = blocked
    ? willCompactOnSend
      ? `~${formatK(used)} / ${formatK(safeLimit)} · Send will compact older messages (keep last 2)`
      : `~${formatK(used)} / ${formatK(safeLimit)} · context full`
    : `~${formatK(used)} / ${formatK(safeLimit)} · ~${formatK(remaining)} left`;

  return (
    <span
      className={`chat-context-meter is-${tone}`}
      title={title}
      aria-label={`Context ${title}`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle
          className="chat-context-meter-track"
          cx="9"
          cy="9"
          r={r}
          fill="none"
          strokeWidth="2"
        />
        <circle
          className="chat-context-meter-fill"
          cx="9"
          cy="9"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 9 9)"
        />
      </svg>
    </span>
  );
}
