import {
  formatModelOptionLabel,
  VENDOR_LABEL,
} from "../../ai/models";
import type { AiModelVendor, ChatMode } from "../../ai/types";
import { useAiSettingsStore } from "../../store/aiSettingsStore";

const VENDOR_ORDER: AiModelVendor[] = ["anthropic", "openai", "google"];

export function AiSettingsPanel() {
  const settings = useAiSettingsStore((s) => s.settings);
  const setSettings = useAiSettingsStore((s) => s.setSettings);

  return (
    <div className="sync-panel">
      <p className="sync-panel-lead">
        Chat uses{" "}
        <a
          href="https://openrouter.ai/"
          target="_blank"
          rel="noreferrer"
        >
          OpenRouter
        </a>{" "}
        only — one key for Anthropic, Google, and OpenAI models. The key stays
        on this machine and is never written into the vault.
      </p>

      <section className="sync-block">
        <h3 className="sync-block-title">OpenRouter API key</h3>
        <p className="sync-block-desc">
          Create a key at openrouter.ai → Keys.
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.apiKey}
          onChange={(e) => setSettings({ apiKey: e.target.value })}
          placeholder="sk-or-…"
          autoComplete="off"
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Tavily API key</h3>
        <p className="sync-block-desc">
          Optional. Without it, the agent uses free DuckDuckGo search + Jina
          page fetch. With a key from{" "}
          <a href="https://tavily.com" target="_blank" rel="noreferrer">
            Tavily
          </a>
          , both web_search and fetch_url use Tavily (~1k free credits/month).
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.tavilyApiKey}
          onChange={(e) => setSettings({ tavilyApiKey: e.target.value })}
          placeholder="tvly-…"
          autoComplete="off"
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Default model</h3>
        <p className="sync-block-desc">
          Used for new chats. Reasoning models think before answering (slower,
          usually smarter).
        </p>
        <select
          className="sync-input sync-select"
          value={settings.modelId}
          onChange={(e) => setSettings({ modelId: e.target.value })}
        >
          {VENDOR_ORDER.map((vendor) => {
            const group = settings.models.filter((m) => m.vendor === vendor);
            if (!group.length) return null;
            return (
              <optgroup key={vendor} label={VENDOR_LABEL[vendor]}>
                {group.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatModelOptionLabel(m)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Default mode</h3>
        <p className="sync-block-desc">
          Ask is read-only; Agent can create and write notes.
        </p>
        <select
          className="sync-input sync-select"
          value={settings.defaultMode}
          onChange={(e) =>
            setSettings({ defaultMode: e.target.value as ChatMode })
          }
        >
          <option value="ask">Ask</option>
          <option value="agent">Agent</option>
        </select>
      </section>
    </div>
  );
}
