import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from "shiki";

/** Shared light Shiki theme for Live code blocks and chat fences. */
export const CODE_HIGHLIGHT_THEME = "github-light" as const;

type LangMeta = { aliases?: string[] };

/**
 * Common language catalog for chat / fence highlighting.
 * Keys are Shiki language ids; aliases map fence tags → id.
 */
export const HIGHLIGHT_LANGUAGES: Record<string, LangMeta> = {
  javascript: { aliases: ["js", "jsx", "mjs", "cjs"] },
  typescript: { aliases: ["ts", "tsx", "mts", "cts"] },
  python: { aliases: ["py"] },
  rust: { aliases: ["rs"] },
  go: { aliases: ["golang"] },
  java: {},
  kotlin: { aliases: ["kt"] },
  csharp: { aliases: ["cs", "c#"] },
  cpp: { aliases: ["c++", "cc", "cxx", "hpp"] },
  c: { aliases: ["h"] },
  ruby: { aliases: ["rb"] },
  php: {},
  swift: {},
  scala: {},
  html: { aliases: ["htm"] },
  css: {},
  scss: {},
  json: {},
  yaml: { aliases: ["yml"] },
  toml: {},
  markdown: { aliases: ["md", "mdx"] },
  shellscript: { aliases: ["bash", "sh", "shell", "zsh"] },
  powershell: { aliases: ["ps1", "ps"] },
  sql: {},
  graphql: { aliases: ["gql"] },
  xml: {},
  dockerfile: { aliases: ["docker"] },
  diff: {},
  ini: {},
  lua: {},
  r: {},
  perl: {},
  haskell: { aliases: ["hs"] },
  elixir: { aliases: ["ex", "exs"] },
  erlang: { aliases: ["erl"] },
  clojure: { aliases: ["clj"] },
  zig: {},
  vue: {},
  svelte: {},
};

const LANG_IDS = Object.keys(HIGHLIGHT_LANGUAGES) as BundledLanguage[];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [CODE_HIGHLIGHT_THEME],
      langs: LANG_IDS,
    });
  }
  return highlighterPromise;
}

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
  const match = Object.entries(HIGHLIGHT_LANGUAGES).find(
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
      await highlighter.loadLanguage(resolved as BundledLanguage);
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
