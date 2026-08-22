import { IELTS_KEY_CHIPS } from "../../ai/ieltsFit";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { IeltsKeyChips } from "./IeltsKeyChips";

export function KeysSettingsPanel() {
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
        and are never written into the vault. Hover an IELTS chip for a 1–3 fit
        score (3 is best). Practice sessions pick filled keys from strongest to
        weakest.
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
        <IeltsKeyChips
          chips={IELTS_KEY_CHIPS.openrouter}
          keyFilled={Boolean(settings.apiKey.trim())}
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">OpenAI API key</h3>
        <p className="sync-block-desc">
          Direct access for GPT and o-series models (bypasses OpenRouter). Also
          powers IELTS Listening TTS and Speaking Whisper.
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.openaiApiKey}
          onChange={(e) => setSettings({ openaiApiKey: e.target.value })}
          placeholder="sk-…"
          autoComplete="off"
        />
        <IeltsKeyChips
          chips={IELTS_KEY_CHIPS.openai}
          keyFilled={Boolean(settings.openaiApiKey.trim())}
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Anthropic API key</h3>
        <p className="sync-block-desc">
          Direct access for Claude models (bypasses OpenRouter). Preferred for
          IELTS Writing and Reading generation.
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.anthropicApiKey}
          onChange={(e) => setSettings({ anthropicApiKey: e.target.value })}
          placeholder="sk-ant-…"
          autoComplete="off"
        />
        <IeltsKeyChips
          chips={IELTS_KEY_CHIPS.anthropic}
          keyFilled={Boolean(settings.anthropicApiKey.trim())}
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
        <IeltsKeyChips
          chips={IELTS_KEY_CHIPS.google}
          keyFilled={Boolean(settings.googleApiKey.trim())}
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Deepgram API key</h3>
        <p className="sync-block-desc">
          Optional. Preferred speech-to-text for IELTS Speaking when set;
          otherwise OpenAI Whisper is used.
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.deepgramApiKey}
          onChange={(e) => setSettings({ deepgramApiKey: e.target.value })}
          placeholder="dg-…"
          autoComplete="off"
        />
        <IeltsKeyChips
          chips={IELTS_KEY_CHIPS.deepgram}
          keyFilled={Boolean(settings.deepgramApiKey.trim())}
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">ElevenLabs API key</h3>
        <p className="sync-block-desc">
          Optional TTS when no OpenAI key is set. Used for generated Listening
          audio and a spoken examiner.
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.elevenLabsApiKey}
          onChange={(e) => setSettings({ elevenLabsApiKey: e.target.value })}
          placeholder="sk_…"
          autoComplete="off"
        />
        <IeltsKeyChips
          chips={IELTS_KEY_CHIPS.elevenlabs}
          keyFilled={Boolean(settings.elevenLabsApiKey.trim())}
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Azure Speech</h3>
        <p className="sync-block-desc">
          Listening audio (British neural voices) and optional pronunciation
          scores after IELTS Speaking. Region example: westeurope. One Speech
          resource is enough — you do not need a second Azure product.
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.azureSpeechKey}
          onChange={(e) => setSettings({ azureSpeechKey: e.target.value })}
          placeholder="Azure speech key"
          autoComplete="off"
        />
        <input
          type="text"
          className="sync-input"
          style={{ marginTop: 8 }}
          value={settings.azureSpeechRegion}
          onChange={(e) => setSettings({ azureSpeechRegion: e.target.value })}
          placeholder="Region (e.g. westeurope)"
          autoComplete="off"
        />
        <IeltsKeyChips
          chips={IELTS_KEY_CHIPS.azure}
          keyFilled={Boolean(
            settings.azureSpeechKey.trim() && settings.azureSpeechRegion.trim(),
          )}
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
        <IeltsKeyChips
          chips={IELTS_KEY_CHIPS.tavily}
          keyFilled={Boolean(settings.tavilyApiKey.trim())}
        />
      </section>
    </div>
  );
}
