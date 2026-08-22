import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistedEditorScroll } from "../../hooks/usePersistedEditorScroll";
import { SETTINGS_TAB_PATH } from "../../store/vaultStore";
import {
  CATEGORIES,
  SETTINGS_REGISTRY,
  matchesQuery,
  settingsForCategory,
} from "../../settings/registry";
import type { PrefKey } from "../../settings/types";
import { usePrefsStore, useSettingsTabActive } from "../../store/prefsStore";
import { AboutSettingsPanel } from "./AboutSettingsPanel";
import { AiSettingsPanel } from "./AiSettingsPanel";
import { DiarySettingsPanel } from "./DiarySettingsPanel";
import { IndexingSettingsPanel } from "./IndexingSettingsPanel";
import { KeysSettingsPanel } from "./KeysSettingsPanel";
import { MemorySettingsPanel } from "./MemorySettingsPanel";
import { McpSettingsPanel } from "./McpSettingsPanel";
import { SettingRow } from "./SettingRow";
import { SyncSettingsPanel } from "./SyncSettingsPanel";

type Props = {
  onClose: () => void;
};

const PANEL_CATEGORIES = new Set([
  "sync",
  "keys",
  "ai",
  "mcp",
  "memory",
  "diary",
  "indexing",
  "about",
]);

function queryMatchesSync(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    "sync".includes(q) ||
    q.includes("sync") ||
    q.includes("github") ||
    q.includes("git") ||
    q.includes("token") ||
    q.includes("remote")
  );
}

function queryMatchesKeys(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    "keys".includes(q) ||
    q.includes("key") ||
    q.includes("api") ||
    q.includes("api key") ||
    q.includes("apikey") ||
    q.includes("byok") ||
    q.includes("openrouter") ||
    q.includes("openai") ||
    q.includes("anthropic") ||
    q.includes("google") ||
    q.includes("tavily") ||
    q.includes("firecrawl") ||
    q.includes("ielts") ||
    q.includes("deepgram") ||
    q.includes("eleven") ||
    q.includes("azure") ||
    q.includes("whisper")
  );
}

function queryMatchesAi(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    "ai".includes(q) ||
    q.includes("ai") ||
    q.includes("model") ||
    q.includes("openai") ||
    q.includes("anthropic") ||
    q.includes("claude") ||
    q.includes("google") ||
    q.includes("gemini") ||
    q.includes("llm") ||
    q.includes("chat") ||
    q.includes("agent") ||
    q.includes("reasoning") ||
    q.includes("context") ||
    q.includes("embedding") ||
    q.includes("worker") ||
    q.includes("flagship")
  );
}

function queryMatchesMemory(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    "memory".includes(q) ||
    q.includes("memory") ||
    q.includes("memories") ||
    q.includes("remember") ||
    q.includes("forget")
  );
}

function queryMatchesDiary(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    "diary".includes(q) ||
    q.includes("diary") ||
    q.includes("calendar") ||
    q.includes("marker") ||
    q.includes("emoji") ||
    q.includes("day marker")
  );
}

function queryMatchesIndexing(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    "indexing".includes(q) ||
    q.includes("index") ||
    q.includes("indexing") ||
    q.includes("embedding") ||
    q.includes("semantic") ||
    q.includes("delay")
  );
}

function queryMatchesMcp(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    "mcp".includes(q) ||
    q.includes("mcp") ||
    q.includes("model context") ||
    q.includes("stdio") ||
    q.includes("server")
  );
}

function queryMatchesAbout(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    "about".includes(q) ||
    q.includes("about") ||
    q.includes("version") ||
    q.includes("update") ||
    q.includes("upgrade") ||
    q.includes("release")
  );
}

export function SettingsPage({ onClose }: Props) {
  const prefs = usePrefsStore((s) => s.prefs);
  const setPref = usePrefsStore((s) => s.setPref);
  const category = usePrefsStore((s) => s.settingsCategory);
  const setCategory = usePrefsStore((s) => s.setSettingsCategory);
  const settingsActive = useSettingsTabActive();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  usePersistedEditorScroll(listEl, SETTINGS_TAB_PATH, "live", {
    active: settingsActive,
  });

  useEffect(() => {
    if (!settingsActive) return;
    const id = requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [settingsActive]);

  const searching = query.trim().length > 0;
  const showSyncInSearch = searching && queryMatchesSync(query);
  const showKeysInSearch = searching && queryMatchesKeys(query);
  const showAiInSearch = searching && queryMatchesAi(query);
  const showMcpInSearch = searching && queryMatchesMcp(query);
  const showMemoryInSearch = searching && queryMatchesMemory(query);
  const showDiaryInSearch = searching && queryMatchesDiary(query);
  const showIndexingInSearch = searching && queryMatchesIndexing(query);
  const showAboutInSearch = searching && queryMatchesAbout(query);

  const rows = useMemo(() => {
    if (searching) {
      return SETTINGS_REGISTRY.filter((s) => matchesQuery(s, query));
    }
    if (PANEL_CATEGORIES.has(category)) return [];
    return settingsForCategory(category);
  }, [category, query, searching]);

  const grouped = useMemo(() => {
    if (!searching) return null;
    return CATEGORIES.filter((cat) => !PANEL_CATEGORIES.has(cat.id))
      .map((cat) => ({
        ...cat,
        settings: rows.filter((s) => s.category === cat.id),
      }))
      .filter((g) => g.settings.length > 0);
  }, [rows, searching]);

  const showSyncPanel = (!searching && category === "sync") || showSyncInSearch;
  const showKeysPanel = (!searching && category === "keys") || showKeysInSearch;
  const showAiPanel = (!searching && category === "ai") || showAiInSearch;
  const showMcpPanel = (!searching && category === "mcp") || showMcpInSearch;
  const showMemoryPanel =
    (!searching && category === "memory") || showMemoryInSearch;
  const showDiaryPanel =
    (!searching && category === "diary") || showDiaryInSearch;
  const showIndexingPanel =
    (!searching && category === "indexing") || showIndexingInSearch;
  const showAboutPanel =
    (!searching && category === "about") || showAboutInSearch;

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div className="settings-header-title">
          <h1>Settings</h1>
          <p>Configure MarkSpace</p>
        </div>
        <button
          type="button"
          className="settings-close"
          aria-label="Close settings"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="settings-search-wrap">
        <input
          ref={searchRef}
          className="settings-search"
          type="search"
          placeholder="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="settings-body">
        {!searching && (
          <nav className="settings-nav" aria-label="Settings categories">
            {CATEGORIES.map((cat) => (
              <div key={cat.id} className="settings-nav-group">
                {cat.separatorBefore && (
                  <div className="settings-nav-separator" role="separator" />
                )}
                <button
                  type="button"
                  className={
                    category === cat.id
                      ? "settings-nav-item is-active"
                      : "settings-nav-item"
                  }
                  onClick={() => setCategory(cat.id)}
                >
                  {cat.label}
                </button>
              </div>
            ))}
          </nav>
        )}

        <div className="settings-list" ref={setListEl}>
          {rows.length === 0 &&
            !showSyncPanel &&
            !showKeysPanel &&
            !showAiPanel &&
            !showMcpPanel &&
            !showMemoryPanel &&
            !showDiaryPanel &&
            !showIndexingPanel &&
            !showAboutPanel && (
              <div className="settings-empty">
                No settings match “{query.trim()}”
              </div>
            )}

          {searching &&
            grouped?.map((group) => (
              <section key={group.id} className="settings-section">
                <h2 className="settings-section-title">{group.label}</h2>
                {group.settings.map((setting) => (
                  <SettingRow
                    key={setting.id}
                    setting={setting}
                    value={prefs[setting.id]}
                    onChange={(value) => setPref(setting.id as PrefKey, value)}
                  />
                ))}
              </section>
            ))}

          {showKeysPanel && (
            <section className="settings-section">
              {searching && <h2 className="settings-section-title">API keys</h2>}
              <KeysSettingsPanel />
            </section>
          )}

          {showAiPanel && (
            <section className="settings-section">
              {searching && <h2 className="settings-section-title">AI</h2>}
              <AiSettingsPanel />
            </section>
          )}

          {showMcpPanel && (
            <section className="settings-section">
              {searching && <h2 className="settings-section-title">MCP</h2>}
              <McpSettingsPanel />
            </section>
          )}

          {showMemoryPanel && (
            <section className="settings-section">
              {searching && <h2 className="settings-section-title">Memory</h2>}
              <MemorySettingsPanel />
            </section>
          )}

          {showDiaryPanel && (
            <section className="settings-section">
              {searching && <h2 className="settings-section-title">Diary</h2>}
              <DiarySettingsPanel />
            </section>
          )}

          {showIndexingPanel && (
            <section className="settings-section">
              {searching && (
                <h2 className="settings-section-title">Indexing</h2>
              )}
              <IndexingSettingsPanel />
            </section>
          )}

          {showSyncPanel && (
            <section className="settings-section">
              {searching && <h2 className="settings-section-title">Sync</h2>}
              <SyncSettingsPanel />
            </section>
          )}

          {showAboutPanel && (
            <section className="settings-section">
              {searching && <h2 className="settings-section-title">About</h2>}
              <AboutSettingsPanel />
            </section>
          )}

          {!searching &&
            !PANEL_CATEGORIES.has(category) &&
            rows.map((setting) => (
              <SettingRow
                key={setting.id}
                setting={setting}
                value={prefs[setting.id]}
                onChange={(value) => setPref(setting.id as PrefKey, value)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
