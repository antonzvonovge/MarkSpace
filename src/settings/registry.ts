import type { PrefKey, Prefs } from "./types";
import { DEFAULT_PREFS } from "./types";

export type SettingCategory = "appearance" | "editor";

export type SettingControl =
  | {
      type: "enum";
      options: { value: string; label: string }[];
    }
  | {
      type: "number";
      min: number;
      max: number;
      step?: number;
    };

export type SettingDescriptor = {
  id: PrefKey;
  category: SettingCategory;
  label: string;
  description: string;
  control: SettingControl;
  default: Prefs[PrefKey];
};

export const CATEGORIES: { id: SettingCategory; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
];

const FONT_FAMILY_OPTIONS = [
  { value: "sans", label: "Sans (DM Sans)" },
  { value: "mono", label: "Mono (IBM Plex Mono)" },
];

export const SETTINGS_REGISTRY: SettingDescriptor[] = [
  {
    id: "theme",
    category: "appearance",
    label: "Color Theme",
    description: "Overall light or dark appearance of the workbench.",
    control: {
      type: "enum",
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
    },
    default: DEFAULT_PREFS.theme,
  },
  {
    id: "uiFontSize",
    category: "appearance",
    label: "UI Font Size",
    description: "Base font size for the shell (sidebar, tabs, settings).",
    control: { type: "number", min: 11, max: 20, step: 1 },
    default: DEFAULT_PREFS.uiFontSize,
  },
  {
    id: "liveFontSize",
    category: "editor",
    label: "Live Font Size",
    description: "Font size in the Live (rich) editor.",
    control: { type: "number", min: 11, max: 28, step: 1 },
    default: DEFAULT_PREFS.liveFontSize,
  },
  {
    id: "liveFontFamily",
    category: "editor",
    label: "Live Font Family",
    description: "Typeface for the Live editor.",
    control: { type: "enum", options: FONT_FAMILY_OPTIONS },
    default: DEFAULT_PREFS.liveFontFamily,
  },
  {
    id: "sourceFontSize",
    category: "editor",
    label: "Source Font Size",
    description: "Font size in the Source (Markdown) editor.",
    control: { type: "number", min: 11, max: 28, step: 1 },
    default: DEFAULT_PREFS.sourceFontSize,
  },
  {
    id: "sourceFontFamily",
    category: "editor",
    label: "Source Font Family",
    description: "Typeface for the Source editor.",
    control: { type: "enum", options: FONT_FAMILY_OPTIONS },
    default: DEFAULT_PREFS.sourceFontFamily,
  },
  {
    id: "defaultViewMode",
    category: "editor",
    label: "Default View Mode",
    description: "Opening mode for notes. Ctrl/Cmd+E still toggles the current session.",
    control: {
      type: "enum",
      options: [
        { value: "live", label: "Live" },
        { value: "source", label: "Source" },
      ],
    },
    default: DEFAULT_PREFS.defaultViewMode,
  },
];

export function settingsForCategory(category: SettingCategory): SettingDescriptor[] {
  return SETTINGS_REGISTRY.filter((s) => s.category === category);
}

export function matchesQuery(setting: SettingDescriptor, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    setting.label.toLowerCase().includes(q) ||
    setting.description.toLowerCase().includes(q) ||
    setting.id.toLowerCase().includes(q)
  );
}
