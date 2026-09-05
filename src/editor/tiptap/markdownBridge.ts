/**
 * Markdown ↔ HTML for the TipTap Live editor (no @blocknote/core convert).
 *
 * Input markdown is already projected (wiki→md links, math, hashtags) — the same
 * surface BlockNote previously received via `markdownToHTML`.
 */

import { marked, Renderer } from "marked";
import type { Tokens } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import {
  indentFencedCodeBodies,
  isolateNestedLists,
  renestListChildren,
} from "../../lib/nestedListMarkdown";

const LANGUAGE_CLASS_RE = /(?:^|\s)language-(\S+)/;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const renderer = new Renderer();
renderer.code = ({ text, lang, escaped }: Tokens.Code): string => {
  const language = (lang ?? "").match(/^\S*/)?.[0] ?? "";
  const body = text.replace(/\n$/, "") + "\n";
  const content = escaped ? body : escapeHtml(body);
  if (!language) {
    return `<pre><code>${content}</code></pre>\n`;
  }
  const safeLang = escapeHtml(language);
  return `<pre><code class="language-${safeLang}" data-language="${safeLang}">${content}</code></pre>\n`;
};

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer,
});

/**
 * Turn GFM checkbox `<li>` lists into TipTap `taskList` / `taskItem` markup so
 * `setContent` maps them to TaskList / TaskItem nodes.
 */
function promoteGfmTaskLists(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;

  for (const list of Array.from(container.querySelectorAll("ul, ol"))) {
    const items = Array.from(list.children).filter(
      (child) => child.tagName === "LI",
    ) as HTMLElement[];
    if (items.length === 0) continue;

    const allTasks = items.every(
      (li) =>
        !!li.querySelector(
          ":scope > input[type=checkbox], :scope > p > input[type=checkbox]",
        ),
    );
    if (!allTasks) continue;

    let taskList: HTMLElement = list as HTMLElement;
    if (list.tagName === "OL") {
      const ul = document.createElement("ul");
      while (list.firstChild) ul.appendChild(list.firstChild);
      list.replaceWith(ul);
      taskList = ul;
    }

    taskList.setAttribute("data-type", "taskList");

    for (const li of Array.from(taskList.children)) {
      if (!(li instanceof HTMLElement) || li.tagName !== "LI") continue;

      const input = li.querySelector(
        "input[type=checkbox]",
      ) as HTMLInputElement | null;
      const checked = Boolean(input?.checked);
      input?.remove();

      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", String(checked));

      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      if (checked) checkbox.setAttribute("checked", "checked");
      label.appendChild(checkbox);
      label.appendChild(document.createElement("span"));

      const div = document.createElement("div");
      while (li.firstChild) div.appendChild(li.firstChild);
      li.appendChild(label);
      li.appendChild(div);
    }
  }

  return container.innerHTML;
}

/** Markdown → HTML TipTap can `setContent`. */
export function markdownToEditorHtml(markdown: string): string {
  const raw = marked.parse(markdown, { async: false }) as string;
  return isolateNestedLists(promoteGfmTaskLists(raw));
}

function codeLanguage(codeEl: Element): string {
  const fromData = codeEl.getAttribute("data-language")?.trim();
  if (fromData) return fromData;
  const className = codeEl.getAttribute("class") ?? "";
  return className.match(LANGUAGE_CLASS_RE)?.[1] ?? "";
}

function addFencedCodeRule(service: TurndownService): void {
  service.addRule("fencedCodeBlock", {
    filter: (node, options) =>
      options.codeBlockStyle === "fenced" &&
      node.nodeName === "PRE" &&
      !!node.firstChild &&
      (node.firstChild as Element).nodeName === "CODE",
    replacement: (_content, node, options) => {
      const code = node.firstChild as HTMLElement;
      const language = codeLanguage(code);
      const text = code.textContent ?? "";
      const fenceChar = (options.fence ?? "```").charAt(0);
      let fenceSize = 3;
      const fenceInCode = new RegExp(`^${fenceChar}{3,}`, "gm");
      let match: RegExpExecArray | null;
      while ((match = fenceInCode.exec(text))) {
        if (match[0]!.length >= fenceSize) fenceSize = match[0]!.length + 1;
      }
      const fence = fenceChar.repeat(fenceSize);
      return (
        "\n\n" +
        fence +
        language +
        "\n" +
        text.replace(/\n$/, "") +
        "\n" +
        fence +
        "\n\n"
      );
    },
  });
}

/** TipTap task items: checkbox lives under `<label>`, not directly under `<li>`. */
function addTipTapTaskItemRule(service: TurndownService): void {
  service.addRule("tiptapTaskItem", {
    filter: (node) =>
      node.nodeName === "LI" &&
      (node as HTMLElement).getAttribute("data-type") === "taskItem",
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const checked =
        el.getAttribute("data-checked") === "true" ||
        el.getAttribute("data-checked") === "" ||
        !!el.querySelector("input[type=checkbox]:checked");
      const body = content
        .replace(/^\s*\[[ xX]\]\s*/, "")
        .replace(/^\n+/, "")
        .replace(/\n+$/, "");
      const prefix = `- ${checked ? "[x]" : "[ ]"} `;
      const indented = body.replace(/\n/g, "\n" + " ".repeat(prefix.length));
      return prefix + indented + "\n";
    },
  });

  // Avoid serializing the a11y label as visible markdown.
  service.addRule("tiptapTaskLabel", {
    filter: (node) =>
      node.nodeName === "LABEL" &&
      (node.parentNode as HTMLElement | null)?.getAttribute?.("data-type") ===
        "taskItem",
    replacement: () => "",
  });
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  service.use(gfm);
  addFencedCodeRule(service);
  addTipTapTaskItemRule(service);
  return service;
}

let turndownSingleton: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (!turndownSingleton) turndownSingleton = createTurndown();
  return turndownSingleton;
}

/**
 * TipTap `getHTML()` → markdown (replaces `nestedHtmlToMarkdown` /
 * `cleanHTMLToMarkdown` for the TipTap path).
 */
export function editorHtmlToMarkdown(html: string): string {
  const renested = renestListChildren(html);
  const markdown = getTurndown().turndown(renested);
  return indentFencedCodeBodies(markdown);
}
