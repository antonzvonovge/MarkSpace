/**
 * Keep Tab-indented content inside its list item, in both markdown directions.
 *
 * Saving: BlockNote's external HTML exporter only preserves nesting for list
 * items — "other types of blocks nested inside a list are un-nested and a new
 * list is created after them". Those blocks are emitted as siblings carrying
 * `data-nesting-level`, which the HTML→markdown step ignores, so an indented
 * paragraph came out flush left (dropping out of the item, restarting numbered
 * lists at `1.`). We put them back into the `<li>` they belong to and rejoin the
 * lists the exporter split.
 *
 * Loading: BlockNote lifts sub-lists out of their `<li>` before parsing, and the
 * lifted list is dropped to the top level whenever the item already has a body.
 * We hide sub-lists from that step so they survive as children.
 */

import {
  cleanHTMLToMarkdown,
  markdownToHTML,
  type BlockNoteEditor,
} from "@blocknote/core";

const LIST_TAGS = new Set(["UL", "OL"]);

function lastListItem(list: Element): HTMLElement | null {
  for (let i = list.children.length - 1; i >= 0; i--) {
    const child = list.children[i]!;
    if (child.tagName === "LI") return child as HTMLElement;
  }
  return null;
}

function lastNestedList(item: Element): Element | null {
  for (let i = item.children.length - 1; i >= 0; i--) {
    const child = item.children[i]!;
    if (LIST_TAGS.has(child.tagName)) return child;
  }
  return null;
}

/** Deepest `<li>` on the trailing edge of `list`, at most `depth` levels down. */
function listItemAtDepth(list: Element, depth: number): HTMLElement | null {
  let item = lastListItem(list);
  for (let level = 1; level < depth && item; level++) {
    const nested = lastNestedList(item);
    const deeper = nested ? lastListItem(nested) : null;
    if (!deeper) break;
    item = deeper;
  }
  return item;
}

/**
 * Rejoin lists of the same kind that ended up adjacent, so items keep counting
 * instead of restarting at `1.`. A list with an explicit `start` is left alone.
 * Returns whether anything moved.
 */
function mergeAdjacentLists(container: HTMLElement): boolean {
  let merged = false;
  let child = container.firstElementChild;
  while (child) {
    const next = child.nextElementSibling;
    if (
      next &&
      LIST_TAGS.has(child.tagName) &&
      next.tagName === child.tagName &&
      !next.hasAttribute("start")
    ) {
      while (next.firstChild) child.appendChild(next.firstChild);
      next.remove();
      merged = true;
      continue;
    }
    child = next;
  }
  return merged;
}

/** The exporter only marks a block nested when it sits below the top level. */
const NESTING_MARKER = "data-nesting-level";

/**
 * `</ul><ul …>` — same-kind lists left touching, which `mergeAdjacentLists`
 * rejoins. Matches nested lists inside an `<li>` too; those merely fall through
 * to the full pass, which leaves them alone.
 */
const ADJACENT_LISTS_RE = /<\/(ul|ol)>\s*<\1(?=[\s/>])/i;

/**
 * How deep the exporter says this block sits. Lists carry the level on their
 * items, every other block carries it on itself; 0 means top level.
 */
function nestingDepth(element: Element): number {
  const source = LIST_TAGS.has(element.tagName)
    ? element.querySelector(":scope > li")
    : element;
  const depth = Number(source?.getAttribute(NESTING_MARKER));
  return Number.isFinite(depth) && depth >= 1 ? depth : 0;
}

/**
 * Move un-nested list children back into their item.
 *
 * Parsing and re-serializing the whole document is the dominant cost of the
 * Live→markdown export, so both halves are skipped when nothing can move. The
 * result is then the caller's input verbatim, which may differ from a
 * round-tripped copy by parser normalization — the exporter emits `<table>`
 * with no `<tbody>`, for one. Harmless here: the only consumer hands the result
 * to `cleanHTMLToMarkdown`, which parses it and so applies that same
 * normalization anyway.
 */
export function renestListChildren(html: string): string {
  // Nothing is nested, and the exporter only splits a list when it emits a
  // nested block between the halves — so there is also nothing to rejoin.
  if (!html.includes(NESTING_MARKER) && !ADJACENT_LISTS_RE.test(html)) {
    return html;
  }

  const container = document.createElement("div");
  container.innerHTML = html;

  let moved = false;
  let list: Element | null = null;
  for (const child of Array.from(container.children)) {
    const depth = nestingDepth(child);
    const item = depth && list ? listItemAtDepth(list, depth) : null;

    if (item) {
      child.removeAttribute(NESTING_MARKER);
      item.appendChild(child);
      moved = true;
      continue;
    }

    // A top-level list anchors the blocks that follow it; anything else that
    // stayed flat (nesting markdown cannot express) ends that context.
    list = LIST_TAGS.has(child.tagName) ? child : null;
  }

  const merged = mergeAdjacentLists(container);
  return moved || merged ? container.innerHTML : html;
}

/**
 * BlockNote indents only the opening line of a fenced block, so a code fence
 * that now sits inside a list item would leave its body and closing fence at
 * the margin — breaking out of the item. Indent them to the fence's column.
 */
export function indentFencedCodeBodies(markdown: string): string {
  const lines = markdown.split("\n");
  let open: { indent: string; char: string; length: number } | null = null;

  const out = lines.map((line) => {
    if (!open) {
      const opening = line.match(/^([ \t]*)(`{3,}|~{3,})/);
      if (opening) {
        open = {
          indent: opening[1]!,
          char: opening[2]![0]!,
          length: opening[2]!.length,
        };
      }
      return line;
    }

    const closing = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
    const isClose =
      closing != null &&
      closing[1]![0] === open.char &&
      closing[1]!.length >= open.length;

    const needsIndent =
      open.indent !== "" && line.trim() !== "" && !line.startsWith(open.indent);
    const next = needsIndent ? open.indent + line : line;

    if (isClose) open = null;
    return next;
  });

  return out.join("\n");
}

/** BlockNote external HTML → markdown, with list nesting preserved. */
export function nestedHtmlToMarkdown(externalHtml: string): string {
  return indentFencedCodeBodies(
    cleanHTMLToMarkdown(renestListChildren(externalHtml)),
  );
}

/**
 * Hide sub-lists from BlockNote's list preprocessing on the way in.
 *
 * Loading has the mirror problem of saving: BlockNote lifts a `<ul>` out of its
 * `<li>` and re-attaches it as a sibling block group, which ProseMirror then
 * drops back to the top level whenever the item already has a body (a
 * continuation paragraph). Wrapped in a plain `<div>` the sub-list is no longer
 * a direct `<li>` child, so it stays put and is parsed as a child block.
 */
export function isolateNestedLists(html: string): string {
  const textBefore = (node: Element): string => {
    let text = "";
    for (
      let sibling = node.previousSibling;
      sibling;
      sibling = sibling.previousSibling
    ) {
      text += sibling.textContent ?? "";
    }
    return text.trim();
  };

  const container = document.createElement("div");
  container.innerHTML = html;

  for (const list of Array.from(
    container.querySelectorAll("li > ul, li > ol"),
  )) {
    // A sub-list that opens the item has no body to collide with, and BlockNote
    // needs it in place to keep an empty parent item around.
    if (!textBefore(list)) continue;

    const wrapper = document.createElement("div");
    list.replaceWith(wrapper);
    wrapper.appendChild(list);
  }

  return container.innerHTML;
}

/** Markdown → blocks, with list nesting preserved. */
export function markdownToNestedBlocks<E extends BlockNoteEditor<any, any, any>>(
  editor: E,
  markdown: string,
): ReturnType<E["tryParseHTMLToBlocks"]> {
  return editor.tryParseHTMLToBlocks(
    isolateNestedLists(markdownToHTML(markdown)),
  ) as ReturnType<E["tryParseHTMLToBlocks"]>;
}
