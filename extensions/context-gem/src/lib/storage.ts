import {
  DEFAULT_SETTINGS,
  MODEL_OPTIONS,
  type AnalysisMode,
  type ChatSessionPayload,
  type ExtensionSettings,
  type ExplanationLanguage,
  type PanelGeometry,
} from "./types";

const SETTINGS_KEY = "settings";
const PANEL_GEOMETRY_KEY = "panelGeometry";
const ALLOWED_MODELS = new Set<string>(MODEL_OPTIONS.map((m) => m.id));

function normalizeLanguage(raw: unknown): ExplanationLanguage {
  return raw === "ru" ? "ru" : "en";
}

const LEGACY_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
]);

function normalizeModel(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_SETTINGS.model;
  const id = raw.trim();
  if (ALLOWED_MODELS.has(id)) return id;
  if (LEGACY_MODELS.has(id)) return DEFAULT_SETTINGS.model;
  return DEFAULT_SETTINGS.model;
}

export function normalizeSettings(
  raw: Partial<ExtensionSettings> | null | undefined,
): ExtensionSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    googleApiKey:
      typeof raw.googleApiKey === "string" ? raw.googleApiKey.trim() : "",
    model: normalizeModel(raw.model),
    explanationLanguage: normalizeLanguage(raw.explanationLanguage),
  };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY] as Partial<ExtensionSettings>);
}

function normalizeAnalysisMode(raw: unknown): AnalysisMode {
  if (raw === "professional") return "professional";
  if (raw === "student") return "student";
  return "teaching";
}

export async function saveSettings(
  settings: ExtensionSettings,
): Promise<void> {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: normalizeSettings(settings),
  });
}

function normalizePanelGeometry(raw: unknown): PanelGeometry | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Partial<PanelGeometry>;
  if (
    typeof g.top !== "number" ||
    typeof g.left !== "number" ||
    typeof g.width !== "number" ||
    typeof g.height !== "number" ||
    !Number.isFinite(g.top) ||
    !Number.isFinite(g.left) ||
    !Number.isFinite(g.width) ||
    !Number.isFinite(g.height)
  ) {
    return null;
  }
  return {
    top: g.top,
    left: g.left,
    width: g.width,
    height: g.height,
  };
}

export async function loadPanelGeometry(): Promise<PanelGeometry | null> {
  const result = await chrome.storage.local.get(PANEL_GEOMETRY_KEY);
  return normalizePanelGeometry(result[PANEL_GEOMETRY_KEY]);
}

export async function savePanelGeometry(
  geometry: PanelGeometry,
): Promise<void> {
  await chrome.storage.local.set({ [PANEL_GEOMETRY_KEY]: geometry });
}

export function sessionStorageKey(sessionId: string): string {
  return `chat:${sessionId}`;
}

export async function saveChatSession(
  sessionId: string,
  payload: ChatSessionPayload,
): Promise<void> {
  await chrome.storage.session.set({
    [sessionStorageKey(sessionId)]: payload,
  });
}

export async function loadChatSession(
  sessionId: string,
): Promise<ChatSessionPayload | null> {
  const key = sessionStorageKey(sessionId);
  const result = await chrome.storage.session.get(key);
  const payload = result[key];
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<ChatSessionPayload>;
  if (typeof p.selection !== "string") return null;
  return {
    selection: p.selection,
    pageUrl: typeof p.pageUrl === "string" ? p.pageUrl : "",
    pageTitle: typeof p.pageTitle === "string" ? p.pageTitle : "",
    mode: normalizeAnalysisMode(p.mode),
  };
}
