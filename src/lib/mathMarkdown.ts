/**
 * Inline / display math (`$…$`, `$$…$$`) ↔ BlockNote intermediate forms.
 *
 * On disk the source of truth is TeX delimited by `$` / `$$`. For Live editing we
 * project inline math to `data-latex` spans (`@defensestation/blocknote-math`) and
 * display math to fenced ` ```math ` blocks (custom equation block).
 */

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeHtmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Live intermediate for inline `$latex$`. */
export function inlineMathToEditorHtml(latex: string): string {
  const safe = escapeHtmlAttr(latex);
  return `<span data-inline-content-type="latex" data-latex="${safe}"></span>`;
}

/** Live intermediate for display `$$latex$$` (HTML so BlockNote keeps it in lists). */
export function blockMathToEditorHtml(latex: string): string {
  const safe = escapeHtmlAttr(latex);
  // Prefer a data-content-type div over an indented ```math fence: BlockNote
  // drops indented fences inside list items as empty `codeBlock`s.
  return `<div data-content-type="equation" data-latex="${safe}"></div>`;
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "protect"; text: string };

/**
 * Split markdown into unprotected text vs protected regions (fences, inline
 * code, HTML tags, markdown links/images).
 */
function segmentMarkdown(source: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  const n = source.length;

  const pushText = (text: string) => {
    if (!text) return;
    out.push({ kind: "text", text });
  };
  const pushProtect = (text: string) => {
    if (!text) return;
    out.push({ kind: "protect", text });
  };

  while (i < n) {
    if (
      (source.startsWith("```", i) || source.startsWith("~~~", i)) &&
      (i === 0 || source[i - 1] === "\n")
    ) {
      const fenceChar = source[i]!;
      const fenceRun = source.slice(i).match(new RegExp(`^${fenceChar}{3,}`))?.[0]
        ?.length;
      if (fenceRun) {
        const openEnd = i + fenceRun;
        const nl = source.indexOf("\n", openEnd);
        const afterInfo = nl === -1 ? n : nl + 1;
        const closeRe = new RegExp(
          `\\n${fenceChar}{${fenceRun},}[ \\t]*(?=\\n|$)`,
        );
        const rest = source.slice(afterInfo);
        const closeMatch = rest.match(closeRe);
        if (closeMatch && closeMatch.index !== undefined) {
          const end = afterInfo + closeMatch.index + closeMatch[0].length;
          pushProtect(source.slice(i, end));
          i = end;
          continue;
        }
        pushProtect(source.slice(i));
        break;
      }
    }

    if (source[i] === "`") {
      const tickRun = source.slice(i).match(/^`+/)?.[0]?.length ?? 1;
      const close = source.indexOf("`".repeat(tickRun), i + tickRun);
      if (close !== -1) {
        pushProtect(source.slice(i, close + tickRun));
        i = close + tickRun;
        continue;
      }
    }

    if (source[i] === "<") {
      const slice = source.slice(i);
      const tagMatch = slice.match(/^<\/?[A-Za-z][^>]*>/);
      if (tagMatch) {
        pushProtect(tagMatch[0]);
        i += tagMatch[0].length;
        continue;
      }
    }

    if (source[i] === "[" || (source[i] === "!" && source[i + 1] === "[")) {
      const start = i;
      if (source[i] === "!") i += 1;
      if (source[i] === "[") {
        const closeBracket = source.indexOf("]", i + 1);
        if (
          closeBracket !== -1 &&
          source[closeBracket + 1] === "(" &&
          source.indexOf(")", closeBracket + 2) !== -1
        ) {
          const closeParen = source.indexOf(")", closeBracket + 2);
          pushProtect(source.slice(start, closeParen + 1));
          i = closeParen + 1;
          continue;
        }
      }
      i = start;
    }

    if (source[i] === "<" && /^<[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source.slice(i))) {
      const close = source.indexOf(">", i + 1);
      if (close !== -1) {
        pushProtect(source.slice(i, close + 1));
        i = close + 1;
        continue;
      }
    }

    let j = i + 1;
    while (j < n) {
      const c = source[j]!;
      if (c === "`" || c === "[" || (c === "!" && source[j + 1] === "[")) {
        break;
      }
      // Only split on `<` when it starts a real HTML/autolink tag — otherwise
      // `$<5$` / `$a < b$` would be torn apart and never project to KaTeX.
      if (c === "<") {
        const rest = source.slice(j);
        if (
          /^<\/?[A-Za-z][^>]*>/.test(rest) ||
          /^<[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rest)
        ) {
          break;
        }
      }
      if (
        c === "\n" &&
        (source.startsWith("```", j + 1) || source.startsWith("~~~", j + 1))
      ) {
        j += 1;
        break;
      }
      j += 1;
    }
    pushText(source.slice(i, j));
    i = j;
  }

  return out;
}

function isEscapedDollar(source: string, index: number): boolean {
  let bs = 0;
  for (let k = index - 1; k >= 0 && source[k] === "\\"; k -= 1) bs += 1;
  return bs % 2 === 1;
}

function rewriteMathInText(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;

  while (i < n) {
    if (text[i] !== "$" || isEscapedDollar(text, i)) {
      out += text[i];
      i += 1;
      continue;
    }

    // Display: $$…$$
    if (text[i + 1] === "$") {
      let j = i + 2;
      let closed = false;
      while (j < n) {
        if (text[j] === "$" && text[j + 1] === "$" && !isEscapedDollar(text, j)) {
          const latex = text.slice(i + 2, j);
          if (latex.trim()) {
            // Drop indent before `$$` and isolate as its own block — indented
            // ```math / HTML inside list continuations is not parsed as equation.
            out = out.replace(/[ \t]+$/, "");
            if (out.length > 0 && !out.endsWith("\n")) out += "\n";
            if (out.length > 0 && !out.endsWith("\n\n")) out += "\n";
            out += blockMathToEditorHtml(latex.trim());
            out += "\n\n";
            i = j + 2;
            if (text[i] === "\n") i += 1;
            // Drop indent on the following continuation line only when it was
            // the same list-indent that preceded `$$` (keep content).
            closed = true;
            break;
          }
        }
        j += 1;
      }
      if (!closed) {
        out += "$$";
        i += 2;
      }
      continue;
    }

    // Inline: $…$ (single line, no leading/trailing space inside)
    if (text[i + 1] === undefined || /\s/.test(text[i + 1]!)) {
      out += "$";
      i += 1;
      continue;
    }
    let j = i + 1;
    let found = -1;
    while (j < n && text[j] !== "\n") {
      if (text[j] === "$" && !isEscapedDollar(text, j) && text[j + 1] !== "$") {
        const latex = text.slice(i + 1, j);
        if (latex && !/^\s/.test(latex) && !/\s$/.test(latex)) {
          found = j;
          break;
        }
      }
      j += 1;
    }
    if (found === -1) {
      out += "$";
      i += 1;
      continue;
    }
    out += inlineMathToEditorHtml(text.slice(i + 1, found));
    i = found + 1;
  }

  return out;
}

/**
 * remark-math treats one-line `$$…$$` as *inline* math. Expand to the
 * multiline display form so chat (and any remark-math consumer) renders a
 * block equation. Skips fenced/inline code via `segmentMarkdown`.
 */
export function normalizeDisplayMath(source: string): string {
  return segmentMarkdown(source)
    .map((seg) =>
      seg.kind === "protect" ? seg.text : expandOneLineDisplayMath(seg.text),
    )
    .join("");
}

function expandOneLineDisplayMath(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;

  while (i < n) {
    if (text[i] !== "$" || isEscapedDollar(text, i)) {
      out += text[i];
      i += 1;
      continue;
    }
    if (text[i + 1] !== "$") {
      out += "$";
      i += 1;
      continue;
    }
    // Already multiline display opener (`$$\n` or `$$` at EOL before content).
    if (text[i + 2] === "\n") {
      out += "$$";
      i += 2;
      continue;
    }
    let j = i + 2;
    let closed = -1;
    while (j < n && text[j] !== "\n") {
      if (
        text[j] === "$" &&
        text[j + 1] === "$" &&
        !isEscapedDollar(text, j)
      ) {
        closed = j;
        break;
      }
      j += 1;
    }
    if (closed === -1) {
      out += "$$";
      i += 2;
      continue;
    }
    const latex = text.slice(i + 2, closed).trim();
    if (!latex) {
      out += "$$";
      i += 2;
      continue;
    }
    out += `$$\n${latex}\n$$`;
    i = closed + 2;
  }

  return out;
}

/**
 * Project on-disk `$` / `$$` math into BlockNote HTML intermediate.
 * Call after `wikiToMarkdown`.
 */
export function mathToEditorMarkdown(source: string): string {
  return segmentMarkdown(source)
    .map((seg) =>
      seg.kind === "protect" ? seg.text : rewriteMathInText(seg.text),
    )
    .join("");
}

function latexFromAttrs(attrs: string): string | null {
  const m = attrs.match(/\bdata-latex=["']([^"']*)["']/i);
  if (!m) return null;
  const latex = unescapeHtmlAttr(m[1] ?? "").trim();
  return latex || null;
}

/**
 * Find the end index (exclusive) of an HTML element starting at `openEnd`
 * (index after the opening `>`), matching `tagName` with nesting depth.
 */
function findMatchingClose(
  source: string,
  openEnd: number,
  tagName: string,
): number | null {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const closeRe = new RegExp(`</${tagName}\\s*>`, "gi");
  let depth = 1;
  let i = openEnd;
  while (i < source.length && depth > 0) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const open = openRe.exec(source);
    const close = closeRe.exec(source);
    if (!close) return null;
    if (open && open.index < close.index) {
      depth += 1;
      i = open.index + open[0].length;
      continue;
    }
    depth -= 1;
    i = close.index + close[0].length;
    if (depth === 0) return i;
  }
  return null;
}

/**
 * Restore on-disk `$` / `$$` from BlockNote HTML / math fences.
 * Call before `markdownToWiki`.
 */
export function editorMarkdownToMath(source: string): string {
  // BlockNote exports equation blocks as ```math fences.
  let next = source.replace(
    /^```(?:math|latex|equation|tex)[ \t]*\r?\n([\s\S]*?)^```[ \t]*(?=\r?\n|$)/gm,
    (_match, body: string) => {
      const latex = body.replace(/\n$/, "").trim();
      return latex ? `$$${latex}$$` : _match;
    },
  );

  // Manual scan for leftover data-latex HTML (paste / older intermediate).
  let out = "";
  let i = 0;
  while (i < next.length) {
    if (next[i] === "<") {
      const slice = next.slice(i);
      const blockOpen = slice.match(/^<div\b([^>]*\bdata-latex=["'][^"']*["'][^>]*)>/i);
      if (blockOpen) {
        const latex = latexFromAttrs(blockOpen[1] ?? "");
        const openEnd = i + blockOpen[0].length;
        const closeEnd = findMatchingClose(next, openEnd, "div");
        if (latex && closeEnd !== null) {
          out += `$$${latex}$$`;
          i = closeEnd;
          continue;
        }
      }

      const spanOpen = slice.match(
        /^<span\b([^>]*\bdata-latex=["'][^"']*["'][^>]*)>/i,
      );
      if (spanOpen) {
        const latex = latexFromAttrs(spanOpen[1] ?? "");
        const openEnd = i + spanOpen[0].length;
        const closeEnd = findMatchingClose(next, openEnd, "span");
        if (latex && closeEnd !== null) {
          out += `$${latex}$`;
          i = closeEnd;
          continue;
        }
      }

      const selfBlock = slice.match(
        /^<div\b([^>]*\bdata-latex=["'][^"']*["'][^>]*)\s*\/>/i,
      );
      if (selfBlock) {
        const latex = latexFromAttrs(selfBlock[1] ?? "");
        if (latex) {
          out += `$$${latex}$$`;
          i += selfBlock[0].length;
          continue;
        }
      }

      const selfSpan = slice.match(
        /^<span\b([^>]*\bdata-latex=["'][^"']*["'][^>]*)\s*\/>/i,
      );
      if (selfSpan) {
        const latex = latexFromAttrs(selfSpan[1] ?? "");
        if (latex) {
          out += `$${latex}$`;
          i += selfSpan[0].length;
          continue;
        }
      }
    }

    out += next[i];
    i += 1;
  }

  return out;
}
