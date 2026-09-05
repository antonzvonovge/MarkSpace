/**
 * Keep Tab-indented content inside its list item, in both markdown directions.
 *
 * TipTap Live uses `src/editor/tiptap/markdownBridge.ts` (marked + turndown)
 * for convert. The helpers here only touch DOM / markdown strings and are
 * shared by that bridge (and chat paste HTML).
 */

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
 */
export function renestListChildren(html: string): string {
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

    list = LIST_TAGS.has(child.tagName) ? child : null;
  }

  const merged = mergeAdjacentLists(container);
  return moved || merged ? container.innerHTML : html;
}

/**
 * Indent fenced code bodies to the fence's column when the opening fence is
 * indented (e.g. inside a list item).
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

/**
 * Hide sub-lists from list preprocessing on the way in by wrapping nested
 * lists that follow item body text in a plain `<div>`.
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
    if (!textBefore(list)) continue;

    const wrapper = document.createElement("div");
    list.replaceWith(wrapper);
    wrapper.appendChild(list);
  }

  return container.innerHTML;
}
