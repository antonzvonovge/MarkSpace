import { formatChatCostUsd } from "../../ai/llmCost";

type Props = {
  totalUsd: number | null | undefined;
};

export function ChatCostLabel({ totalUsd }: Props) {
  if (totalUsd == null || totalUsd <= 0) return null;

  const label = formatChatCostUsd(totalUsd);
  return (
    <span
      className="chat-cost-label"
      title="Total chat spend reported by the provider or gateway"
      aria-label={`Chat spend ${label}`}
    >
      {label}
    </span>
  );
}
