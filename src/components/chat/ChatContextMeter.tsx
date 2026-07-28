type Props = {
  used: number;
  limit: number;
};

function formatK(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100
      ? `${Math.round(k)}k`
      : `${k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(Math.round(n));
}

export function ChatContextMeter({ used, limit }: Props) {
  const safeLimit = Math.max(1, limit);
  const ratio = Math.min(1, used / safeLimit);
  const pct = Math.round(ratio * 100);
  const r = 7;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - ratio);

  let tone: "ok" | "warn" | "danger" = "ok";
  if (ratio >= 0.9) tone = "danger";
  else if (ratio >= 0.7) tone = "warn";

  const title = `~${formatK(used)} / ${formatK(safeLimit)} · ${pct}%`;

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
