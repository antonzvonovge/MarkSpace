import type { EditorFontFamilyId, Prefs } from "./types";

/** Native UI fonts like Cursor (Segoe on Windows, SF on macOS); bundled Ubuntu as fallback. */
const SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", "Ubuntu", system-ui, sans-serif';
const MONO_STACK = '"JetBrains Mono", ui-monospace, monospace';

export function editorFontStack(family: EditorFontFamilyId): string {
  return family === "mono" ? MONO_STACK : SANS_STACK;
}

/** Push prefs into document CSS variables / data-theme. */
export function applyPrefsToDom(prefs: Prefs): void {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.dataset.density = prefs.uiDensity;
  root.style.fontSize = `${prefs.uiFontSize}px`;
  root.style.setProperty("--live-font-size", `${prefs.liveFontSize}px`);
  root.style.setProperty("--font-live", editorFontStack(prefs.liveFontFamily));
  root.style.setProperty("--source-font-size", `${prefs.sourceFontSize}px`);
  root.style.setProperty("--font-source", editorFontStack(prefs.sourceFontFamily));
}
