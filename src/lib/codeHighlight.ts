import type { CodeBlockOptions } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";

/** Shared light Shiki theme for Live code blocks and chat fences. */
export const CODE_HIGHLIGHT_THEME = "github-light" as const;

type Highlighter = Awaited<
  ReturnType<NonNullable<CodeBlockOptions["createHighlighter"]>>
>;

/**
 * Prefer `github-light` as the first loaded theme so BlockNote's
 * `prosemirror-highlight` (which uses `getLoadedThemes()[0]`) paints light tokens.
 */
function preferLightTheme(highlighter: Highlighter): Highlighter {
  const original = highlighter.getLoadedThemes.bind(highlighter);
  highlighter.getLoadedThemes = () => {
    const themes = original();
    if (!themes.includes(CODE_HIGHLIGHT_THEME)) return themes;
    return [
      CODE_HIGHLIGHT_THEME,
      ...themes.filter((theme) => theme !== CODE_HIGHLIGHT_THEME),
    ];
  };
  return highlighter;
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = codeBlockOptions
      .createHighlighter()
      .then(preferLightTheme);
  }
  return highlighterPromise;
}

/**
 * BlockNote code-block options: same language catalog as `@blocknote/code-block`,
 * forced onto the light Shiki theme.
 */
export const markspaceCodeBlockOptions: CodeBlockOptions = {
  ...codeBlockOptions,
  defaultLanguage: "text",
  createHighlighter: () => getHighlighter(),
};

/** Resolve a fence language id to one in the shared catalog (or null). */
export function resolveHighlightLanguage(
  lang: string | undefined,
): string | null {
  if (!lang) return null;
  const key = lang.trim().toLowerCase();
  if (
    !key ||
    key === "text" ||
    key === "plain" ||
    key === "plaintext" ||
    key === "txt" ||
    key === "none"
  ) {
    return null;
  }
  const supported = markspaceCodeBlockOptions.supportedLanguages ?? {};
  const match = Object.entries(supported).find(
    ([id, meta]) => id === key || meta.aliases?.includes(key),
  );
  return match?.[0] ?? null;
}

/**
 * Highlight fenced code to HTML (`<pre class="shiki">…`). Falls back to a plain
 * escaped `<pre><code>` when the language is missing/unsupported.
 */
export async function highlightCodeToHtml(
  code: string,
  lang: string | undefined,
): Promise<string> {
  const resolved = resolveHighlightLanguage(lang);
  if (!resolved) {
    return plainCodeHtml(code, lang);
  }
  try {
    const highlighter = await getHighlighter();
    if (!highlighter.getLoadedLanguages().includes(resolved)) {
      await highlighter.loadLanguage(resolved as never);
    }
    return highlighter.codeToHtml(code, {
      lang: resolved,
      theme: CODE_HIGHLIGHT_THEME,
    });
  } catch {
    return plainCodeHtml(code, lang);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainCodeHtml(code: string, lang: string | undefined): string {
  const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<pre><code${cls}>${escapeHtml(code)}</code></pre>`;
}
