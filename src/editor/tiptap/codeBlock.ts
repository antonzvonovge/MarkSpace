import { mergeAttributes } from "@tiptap/core";
import { CodeBlock, type CodeBlockOptions } from "@tiptap/extension-code-block";

export type NoteCodeBlockOptions = CodeBlockOptions;

/**
 * Code block with `data-language` on `<code>` for markdown / turndown round-trip,
 * plus BlockNote-parity CSS hooks on the outer `<pre>`.
 */
export const NoteCodeBlock = CodeBlock.extend({
  addOptions() {
    const parent = this.parent?.() as CodeBlockOptions | undefined;
    return {
      languageClassPrefix: parent?.languageClassPrefix ?? "language-",
      exitOnTripleEnter: parent?.exitOnTripleEnter ?? true,
      exitOnArrowDown: parent?.exitOnArrowDown ?? true,
      exitOnArrowUp: parent?.exitOnArrowUp ?? true,
      defaultLanguage: parent?.defaultLanguage ?? null,
      enableTabIndentation: parent?.enableTabIndentation ?? false,
      tabSize: parent?.tabSize ?? 4,
      HTMLAttributes: {
        class: "bn-block-content",
        "data-content-type": "codeBlock",
      },
    } satisfies CodeBlockOptions;
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: null,
        parseHTML: (element) => {
          const code =
            element.tagName === "CODE"
              ? element
              : (element.querySelector("code") ?? element);
          const dataLang = code.getAttribute("data-language");
          if (dataLang) return dataLang;
          const { languageClassPrefix } = this.options;
          if (!languageClassPrefix) return null;
          const fromClass = [...code.classList]
            .find((name) => name.startsWith(languageClassPrefix))
            ?.replace(languageClassPrefix, "");
          return fromClass || null;
        },
        rendered: false,
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const language = node.attrs.language as string | null;
    const codeAttrs: Record<string, string> = {};
    if (language) {
      codeAttrs["data-language"] = language;
      if (this.options.languageClassPrefix) {
        codeAttrs.class = `${this.options.languageClassPrefix}${language}`;
      }
    }

    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      ["code", codeAttrs, 0],
    ];
  },
});

export default NoteCodeBlock;
