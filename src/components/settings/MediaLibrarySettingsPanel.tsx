import { useAiSettingsStore } from "../../store/aiSettingsStore";

/** Settings → Media library — Kinopoisk / OMDb keys for Media library projects. */
export function MediaLibrarySettingsPanel() {
  const settings = useAiSettingsStore((s) => s.settings);
  const setSettings = useAiSettingsStore((s) => s.setSettings);

  return (
    <div className="settings-sync-panel">
      <section className="sync-block">
        <h3 className="sync-block-title">Kinopoisk API key</h3>
        <p className="sync-block-desc">
          Optional. Used for Media library lookup when your native language is
          Russian (or the query is Cyrillic): localized title + original title,
          poster, genres. Get a free key at{" "}
          <a
            href="https://kinopoiskapiunofficial.tech/"
            target="_blank"
            rel="noreferrer"
          >
            kinopoiskapiunofficial.tech
          </a>
          .
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.kinopoiskApiKey}
          onChange={(e) => setSettings({ kinopoiskApiKey: e.target.value })}
          placeholder="X-API-KEY"
          autoComplete="off"
        />
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">OMDb API key</h3>
        <p className="sync-block-desc">
          Optional. Used for Media library lookup in English / Latin titles via{" "}
          <a
            href="https://www.omdbapi.com/apikey.aspx"
            target="_blank"
            rel="noreferrer"
          >
            OMDb
          </a>
          . Activate the key from the email, then paste the key only.
        </p>
        <input
          type="password"
          className="sync-input"
          value={settings.omdbApiKey}
          onChange={(e) => setSettings({ omdbApiKey: e.target.value })}
          placeholder="OMDb API key"
          autoComplete="off"
        />
      </section>
    </div>
  );
}
