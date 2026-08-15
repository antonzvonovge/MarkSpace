import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ChatMode } from "../../ai/types";
import {
  AGENT_MAX_STEPS_MAX,
  AGENT_MAX_STEPS_MIN,
  clampAgentMaxSteps,
} from "../../ai/types";
import {
  downloadEmbeddingModel,
  getEmbeddingModelStatus,
  type EmbeddingModelStatus,
} from "../../lib/vaultApi";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { ChatModelPicker } from "../chat/ChatModelPicker";
import { Select } from "../ui/Select";

const MODE_OPTIONS: { value: ChatMode; label: string }[] = [
  { value: "ask", label: "Ask" },
  { value: "agent", label: "Agent" },
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function AiSettingsPanel() {
  const settings = useAiSettingsStore((s) => s.settings);
  const setSettings = useAiSettingsStore((s) => s.setSettings);
  const [embeddingModel, setEmbeddingModel] =
    useState<EmbeddingModelStatus | null>(null);
  const [modelBusy, setModelBusy] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getEmbeddingModelStatus()
      .then(setEmbeddingModel)
      .catch((error) =>
        setEmbeddingModel({
          installed: false,
          downloading: false,
          progress: 0,
          downloadedBytes: 0,
          modelId: "paraphrase-multilingual-MiniLM-L12-v2",
          error: String(error),
        }),
      );
    void listen<EmbeddingModelStatus>(
      "embedding-model://progress",
      (event) => {
        setEmbeddingModel(event.payload);
        setModelBusy(event.payload.downloading);
      },
    ).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const downloadModel = async () => {
    setModelBusy(true);
    try {
      const status = await downloadEmbeddingModel();
      setEmbeddingModel(status);
      setModelBusy(status.downloading);
    } catch (error) {
      setModelBusy(false);
      setEmbeddingModel((current) => ({
        installed: false,
        downloading: false,
        progress: current?.progress ?? 0,
        downloadedBytes: current?.downloadedBytes ?? 0,
        totalBytes: current?.totalBytes,
        modelId:
          current?.modelId ?? "paraphrase-multilingual-MiniLM-L12-v2",
        error: String(error),
      }));
    }
  };

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
        <h3 className="sync-block-title">Local semantic search</h3>
        <p className="sync-block-desc">
          Download the multilingual embedding model separately to enable local
          semantic search for the agent. The model stays on this device and is
          never stored in the vault. Download size is about 460 MB.
        </p>
        {embeddingModel?.downloading && (
          <div className="embedding-download-progress">
            <div className="embedding-download-track" aria-hidden="true">
              <div
                className="embedding-download-fill"
                style={{ width: `${embeddingModel.progress}%` }}
              />
            </div>
            <span>
              Downloading · {embeddingModel.progress}%
              {embeddingModel.downloadedBytes > 0
                ? ` · ${formatBytes(embeddingModel.downloadedBytes)}`
                : ""}
              {embeddingModel.totalBytes
                ? ` / ${formatBytes(embeddingModel.totalBytes)}`
                : ""}
            </span>
          </div>
        )}
        {embeddingModel?.installed && !embeddingModel.downloading && (
          <p className="embedding-model-ready">
            Installed · semantic indexing is enabled
          </p>
        )}
        {embeddingModel?.error && (
          <p className="embedding-model-error">{embeddingModel.error}</p>
        )}
        {!embeddingModel?.installed && !embeddingModel?.downloading && (
          <div className="sync-actions">
            <button
              type="button"
              className="sync-btn sync-btn-primary"
              disabled={modelBusy}
              onClick={() => void downloadModel()}
            >
              {embeddingModel?.error ? "Retry download" : "Download model"}
            </button>
          </div>
        )}
      </section>

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
        <h3 className="sync-block-title">Firecrawl API key</h3>
        <p className="sync-block-desc">
          Optional. Powers Firecrawl browser scrape from{" "}
          <a href="https://www.firecrawl.dev" target="_blank" rel="noreferrer">
            Firecrawl
          </a>
          : <code>scrape_url</code> (markdown only) and{" "}
          <code>clip_article</code> with <code>provider=firecrawl</code> (note +
          images). Not used by ordinary fetch_url / default clip_article.
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.firecrawlApiKey}
          onChange={(e) => setSettings({ firecrawlApiKey: e.target.value })}
          placeholder="fc-…"
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
          , web_search, fetch_url, and clip_article default to Tavily (~1k free
          credits/month).
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
          Ask is read-only; Agent can create and write notes. Terminal
          commands require the setting below.
        </p>
        <Select
          variant="field"
          value={settings.defaultMode}
          options={MODE_OPTIONS}
          aria-label="Default mode"
          onChange={(defaultMode) => setSettings({ defaultMode })}
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Agent step limit</h3>
        <p className="sync-block-desc">
          Max model rounds with tools per user message (not per chat). Each
          round can call several tools in parallel. When the limit is hit, the
          reply stops with a notice — send another message to continue.
        </p>
        <input
          type="number"
          className="sync-input"
          min={AGENT_MAX_STEPS_MIN}
          max={AGENT_MAX_STEPS_MAX}
          step={1}
          value={settings.agentMaxSteps}
          aria-label="Agent step limit"
          onChange={(e) => {
            const raw = e.target.valueAsNumber;
            if (Number.isNaN(raw)) return;
            setSettings({ agentMaxSteps: clampAgentMaxSteps(raw) });
          }}
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Agent terminal</h3>
        <p className="sync-block-desc">
          Lets Agent run shell commands on this computer (cwd stays inside
          the vault). Each command still needs Allow unless you choose Allow
          for this chat. Off by default.
        </p>
        <label className="agent-memory-toggle">
          <input
            type="checkbox"
            checked={settings.agentTerminalEnabled}
            onChange={(e) =>
              setSettings({ agentTerminalEnabled: e.target.checked })
            }
          />
          <span>Allow agent terminal</span>
        </label>
      </section>
    </div>
  );
}
