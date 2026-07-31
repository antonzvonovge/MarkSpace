/** Markers for vault path chips in the chat composer draft string. */
export const VAULT_PATH_OPEN = "⟦";
export const VAULT_PATH_CLOSE = "⟧";

const MARKER_RE = /⟦([^⟧]*)⟧/g;

export function wrapVaultPathMarker(path: string): string {
  const safe = path.replace(/⟧/g, "");
  return `${VAULT_PATH_OPEN}${safe}${VAULT_PATH_CLOSE}`;
}

/** Expand chip markers to plain vault-relative paths for the model. */
export function unwrapVaultPathMarkers(text: string): string {
  return text.replace(MARKER_RE, "$1");
}

const CHIP_LABEL_MAX = 16;

/** Visible chip label: basename only, truncated with … if long. */
export function chipLabelForPath(path: string): string {
  const isDir = path.endsWith("/");
  const trimmed = isDir ? path.replace(/\/+$/, "") : path;
  const base = trimmed.includes("/")
    ? trimmed.slice(trimmed.lastIndexOf("/") + 1)
    : trimmed;
  let name = base || trimmed || path;
  if (isDir) name = name.replace(/\/+$/, "");

  if (name.length > CHIP_LABEL_MAX) {
    const dot = !isDir ? name.lastIndexOf(".") : -1;
    const ext =
      dot > 0 && name.length - dot <= 5 ? name.slice(dot) : "";
    if (ext) {
      const budget = CHIP_LABEL_MAX - ext.length - 1;
      name = `${name.slice(0, Math.max(1, budget))}…${ext}`;
    } else {
      name = `${name.slice(0, CHIP_LABEL_MAX - 1)}…`;
    }
  }

  return isDir ? `${name}/` : name;
}

export function createPathChipElement(path: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = path.endsWith("/")
    ? "chat-path-chip is-dir"
    : "chat-path-chip";
  span.contentEditable = "false";
  span.dataset.vaultPath = path;
  span.textContent = chipLabelForPath(path);
  return span;
}

function isPathChip(el: HTMLElement): boolean {
  return (
    el.classList.contains("chat-path-chip") &&
    typeof el.dataset.vaultPath === "string"
  );
}

/** Serialize contentEditable DOM → draft string with ⟦path⟧ markers. */
export function serializeComposer(root: HTMLElement): string {
  const parts: string[] = [];

  const walk = (el: HTMLElement) => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.textContent ?? "");
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const childEl = child as HTMLElement;
      if (isPathChip(childEl)) {
        parts.push(wrapVaultPathMarker(childEl.dataset.vaultPath!));
        continue;
      }
      if (childEl.tagName === "BR") {
        parts.push("\n");
        continue;
      }
      if (childEl.tagName === "DIV" || childEl.tagName === "P") {
        if (parts.length > 0 && !parts[parts.length - 1]!.endsWith("\n")) {
          parts.push("\n");
        }
        walk(childEl);
        continue;
      }
      walk(childEl);
    }
  };

  walk(root);
  return parts.join("");
}

function appendPlainText(frag: DocumentFragment, text: string) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) frag.appendChild(document.createElement("br"));
    if (lines[i]) frag.appendChild(document.createTextNode(lines[i]!));
  }
}

/** Render draft (with markers) into a contentEditable root. */
export function renderComposerFromDraft(root: HTMLElement, draft: string) {
  root.replaceChildren();
  if (!draft) return;

  const frag = document.createDocumentFragment();
  MARKER_RE.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(draft))) {
    if (match.index > last) {
      appendPlainText(frag, draft.slice(last, match.index));
    }
    frag.appendChild(createPathChipElement(match[1]!));
    last = match.index + match[0].length;
  }
  if (last < draft.length) appendPlainText(frag, draft.slice(last));
  root.appendChild(frag);
}

function charBeforeRange(range: Range): string {
  let node: Node | null = range.startContainer;
  let offset = range.startOffset;
  if (node.nodeType === Node.TEXT_NODE) {
    if (offset > 0) return (node.textContent ?? "")[offset - 1] ?? "";
    node = node.previousSibling;
  } else {
    node = node.childNodes[offset - 1] ?? node.previousSibling;
  }
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (t.length) return t[t.length - 1] ?? "";
    } else if (
      node.nodeType === Node.ELEMENT_NODE &&
      isPathChip(node as HTMLElement)
    ) {
      return "x"; // non-space → add a gap before the new chip
    }
    node = node.previousSibling;
  }
  return "";
}

function charAfterRange(range: Range): string {
  let node: Node | null = range.endContainer;
  let offset = range.endOffset;
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? "";
    if (offset < t.length) return t[offset] ?? "";
    node = node.nextSibling;
  } else {
    node = node.childNodes[offset] ?? node.nextSibling;
  }
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (t.length) return t[0] ?? "";
    } else if (
      node.nodeType === Node.ELEMENT_NODE &&
      isPathChip(node as HTMLElement)
    ) {
      return "x";
    }
    node = node.nextSibling;
  }
  return "";
}

function placeCaretAfter(node: Node) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function rangeAtPoint(
  root: HTMLElement,
  clientX?: number,
  clientY?: number,
): Range {
  if (
    clientX != null &&
    clientY != null &&
    typeof document.caretRangeFromPoint === "function"
  ) {
    const atPoint = document.caretRangeFromPoint(clientX, clientY);
    if (atPoint && root.contains(atPoint.startContainer)) return atPoint;
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0);
    if (root.contains(r.commonAncestorContainer)) return r.cloneRange();
  }
  const end = document.createRange();
  end.selectNodeContents(root);
  end.collapse(false);
  return end;
}

/** Insert a vault path chip at the caret (or drop point). */
export function insertPathChip(
  root: HTMLElement,
  path: string,
  clientX?: number,
  clientY?: number,
): void {
  root.focus();
  const range = rangeAtPoint(root, clientX, clientY);
  range.deleteContents();

  const before = charBeforeRange(range);
  const after = charAfterRange(range);
  const spaceBefore = before.length > 0 && !/\s/.test(before);
  const spaceAfter = after.length > 0 && !/\s/.test(after);

  const nodes: Node[] = [];
  if (spaceBefore) nodes.push(document.createTextNode(" "));
  const chip = createPathChipElement(path);
  nodes.push(chip);
  let afterNode: Node = chip;
  if (spaceAfter) {
    const sp = document.createTextNode(" ");
    nodes.push(sp);
    afterNode = sp;
  }

  const frag = document.createDocumentFragment();
  for (const n of nodes) frag.appendChild(n);
  range.insertNode(frag);
  placeCaretAfter(afterNode);
}

export function isComposerVisuallyEmpty(root: HTMLElement): boolean {
  return serializeComposer(root).trim().length === 0;
}
