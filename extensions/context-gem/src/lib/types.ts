export type ExplanationLanguage = "en" | "ru";

/** How the initial analysis is framed. */
export type AnalysisMode = "teaching" | "professional" | "student";

/** Empty tab opened without a text selection. */
export type FreeChatKind = "general" | "dictionary";

export type ExtensionSettings = {
  googleApiKey: string;
  model: string;
  explanationLanguage: ExplanationLanguage;
};

export const DEFAULT_MODEL = "gemini-3.6-flash";

export const MODEL_OPTIONS = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
] as const;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  googleApiKey: "",
  model: DEFAULT_MODEL,
  explanationLanguage: "en",
};

export type ChatSessionPayload = {
  selection: string;
  pageUrl: string;
  pageTitle: string;
  mode: AnalysisMode;
};

export type GeminiRole = "user" | "model";

export type GeminiContent = {
  role: GeminiRole;
  parts: { text: string }[];
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type PanelGeometry = {
  top: number;
  left: number;
  width: number;
  height: number;
};
