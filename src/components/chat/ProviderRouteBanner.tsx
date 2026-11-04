import { useMemo } from "react";
import { parseModelRef } from "../../ai/modelRef";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useChatStore } from "../../store/chatStore";

/**
 * When the thread model is bound to a missing/disabled provider, offer a
 * one-click switch to the same model under another provider (or Auto).
 */
export function ProviderRouteBanner() {
  const modelId = useChatStore((s) => s.modelId);
  const setModelId = useChatStore((s) => s.setModelId);
  const models = useAiSettingsStore((s) => s.settings.models);
  const providers = useAiSettingsStore((s) => s.settings.providers);

  const issue = useMemo(() => {
    const { modelId: bare, providerId } = parseModelRef(modelId);
    if (!providerId || !bare) return null;
    const provider = providers.find((p) => p.id === providerId);
    if (provider?.enabled) return null;

    const reason = !provider
      ? "This chat’s model is bound to a provider that was removed."
      : `Provider “${provider.name}” is disabled.`;

    const alternatives = models.filter((m) => {
      if (m.id === modelId) return false;
      const parsed = parseModelRef(m.id);
      if (parsed.modelId !== bare) return false;
      if (!parsed.providerId) return true;
      const p = providers.find((x) => x.id === parsed.providerId);
      return Boolean(p?.enabled);
    });

    const switchTo = alternatives[0] ?? null;
    const switchLabel = switchTo
      ? (() => {
          const pid = parseModelRef(switchTo.id).providerId;
          if (!pid) return "Switch to Auto";
          const name = providers.find((p) => p.id === pid)?.name;
          return name ? `Switch to ${name}` : "Switch model";
        })()
      : null;

    return { reason, switchTo, switchLabel };
  }, [modelId, models, providers]);

  if (!issue) return null;

  return (
    <div className="chat-error" role="alert">
      <div className="chat-error-text">{issue.reason}</div>
      {issue.switchTo && issue.switchLabel ? (
        <button
          type="button"
          className="chat-error-dismiss"
          onClick={() => setModelId(issue.switchTo!.id)}
        >
          {issue.switchLabel}
        </button>
      ) : null}
    </div>
  );
}
