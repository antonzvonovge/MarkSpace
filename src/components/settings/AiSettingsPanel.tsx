import type { ChatMode } from "../../ai/types";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { ChatModelPicker } from "../chat/ChatModelPicker";

export function AiSettingsPanel() {
  const settings = useAiSettingsStore((s) => s.settings);
  const setSettings = useAiSettingsStore((s) => s.setSettings);

  return (
    <div className="sync-panel">
      <p className="sync-panel-lead">
        Add provider API keys to call models directly. When a provider key is
        set, chat uses that API and skips{" "}
        <a
          href="https://openrouter.ai/"
          target="_blank"
          rel="noreferrer"
        >
          OpenRouter
        </a>
        . Otherwise OpenRouter is used as a fallback. Keys stay on this machine
        and are never written into the vault.
      </p>

      <section className="sync-block">
        <h3 className="sync-block-title">OpenRouter API key</h3>
        <p className="sync-block-desc">
          Fallback for any model when the matching provider key is empty.
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
        <h3 className="sync-block-title">OpenAI API key</h3>
        <p className="sync-block-desc">
          Direct access for GPT and o-series models (bypasses OpenRouter).
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.openaiApiKey}
          onChange={(e) => setSettings({ openaiApiKey: e.target.value })}
          placeholder="sk-…"
          autoComplete="off"
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Anthropic API key</h3>
        <p className="sync-block-desc">
          Direct access for Claude models (bypasses OpenRouter).
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.anthropicApiKey}
          onChange={(e) => setSettings({ anthropicApiKey: e.target.value })}
          placeholder="sk-ant-…"
          autoComplete="off"
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Google AI API key</h3>
        <p className="sync-block-desc">
          Direct access for Gemini models (bypasses OpenRouter).
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.googleApiKey}
          onChange={(e) => setSettings({ googleApiKey: e.target.value })}
          placeholder="AIza…"
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
        <ChatModelPicker
          models={settings.models}
          value={settings.modelId}
          variant="field"
          onChange={(modelId) => setSettings({ modelId })}
        />
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
