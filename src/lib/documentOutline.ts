/** Heading outline (TOC) for BlockNote live documents, levels 1–3. */

export type OutlineHeading = {
  id: string;
  level: 1 | 2 | 3;
  text: string;
};

export type OutlineNode = OutlineHeading & {
  /** Stable across reloads (BlockNote `id` is not). */
  key: string;
  children: OutlineNode[];
};

type InlineLike = {
  type?: string;
  text?: string;
  content?: InlineLike[];
};

type BlockLike = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockLike[];
};

/** Flatten BlockNote inline content to plain text. */
export function inlineContentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const item of content as InlineLike[]) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text") {
      out += item.text ?? "";
    } else if (item.type === "link") {
      out += inlineContentText(item.content);
    } else if (typeof item.text === "string") {
      out += item.text;
    } else if (Array.isArray(item.content)) {
      out += inlineContentText(item.content);
    }
  }
  return out;
}

/**
 * Stable key for persistence. BlockNote regenerates block ids on each
 * markdown parse, so collapse state must use heading identity instead.
 */
export function makeOutlineKey(
  level: number,
  text: string,
  seen: Map<string, number>,
): string {
  const base = `${level}:${text}`;
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}#${n}`;
}

/** Collect headings (≤ h3) in document order, including nested blocks. */
export function collectOutlineHeadings(blocks: readonly unknown[]): OutlineHeading[] {
  const out: OutlineHeading[] = [];

  const walk = (list: readonly unknown[]) => {
    for (const raw of list) {
      const block = raw as BlockLike;
      if (block.type === "heading" && block.id) {
        const level = Number(block.props?.level);
        if (level >= 1 && level <= 3) {
          const text = inlineContentText(block.content).trim();
          out.push({
            id: block.id,
            level: level as 1 | 2 | 3,
            text: text || "Untitled",
          });
        }
      }
      if (block.children?.length) walk(block.children);
    }
  };

  walk(blocks);
  return out;
}

/** Nest flat headings into a tree by level. */
export function buildOutlineTree(headings: OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const seen = new Map<string, number>();

  for (const heading of headings) {
    const node: OutlineNode = {
      ...heading,
      key: makeOutlineKey(heading.level, heading.text, seen),
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

export function buildDocumentOutline(blocks: readonly unknown[]): OutlineNode[] {
  return buildOutlineTree(collectOutlineHeadings(blocks));
}

/** Stable keys of nodes that have children (can expand/collapse). */
export function collectExpandableKeys(nodes: OutlineNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: OutlineNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        keys.push(node.key);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return keys;
}
