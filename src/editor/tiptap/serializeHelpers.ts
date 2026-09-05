/**
 * Collect image / colored-table projections from a TipTap document for
 * markdown post-process (same role as BlockNote `collectImageSizeRefs` /
 * `projectColoredTables`).
 */

import type { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import type { ImageSizeRef } from "../../lib/imageMarkdown";

function parseSizedAlt(
  alt: string,
): { name: string; previewWidth: number } | null {
  const pipe = /^(.*?)\|(\d+)(?:x\d+)?$/.exec(alt);
  if (pipe) {
    const previewWidth = Number(pipe[2]);
    if (!Number.isFinite(previewWidth) || previewWidth <= 0) return null;
    return { name: (pipe[1] ?? "").trim(), previewWidth };
  }
  const only = /^(\d+)(?:x\d+)?$/.exec(alt.trim());
  if (only) {
    const previewWidth = Number(only[1]);
    if (!Number.isFinite(previewWidth) || previewWidth <= 0) return null;
    return { name: "", previewWidth };
  }
  return null;
}

function nodePreviewWidth(attrs: Record<string, unknown>): number | undefined {
  const raw = attrs.width ?? attrs.previewWidth;
  if (raw == null || raw === "") return undefined;
  const n =
    typeof raw === "number" ? raw : Number(String(raw).replace(/px$/i, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** Depth-first image nodes → size refs for `applyImagePreviewWidths`. */
export function collectImageSizeRefsFromTiptap(
  editor: Editor,
): ImageSizeRef[] {
  const out: ImageSizeRef[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "image") return;
    const src = String(node.attrs.src ?? "");
    if (!src) return;
    const alt = String(node.attrs.alt ?? "");
    const fromAttr = nodePreviewWidth(node.attrs as Record<string, unknown>);
    const fromAlt = parseSizedAlt(alt);
    out.push({
      url: src,
      name: fromAlt?.name ?? alt,
      previewWidth: fromAttr ?? fromAlt?.previewWidth,
    });
  });
  return out;
}

/**
 * After `setContent`, move `alt|width` / bare `width` into image `width` attrs
 * and clean the alt text (Obsidian-style preview widths).
 */
export function applyImageWidthsFromAltInEditor(editor: Editor): void {
  const updates: Array<{ pos: number; alt: string; width: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "image") return;
    const alt = String(node.attrs.alt ?? "");
    const parsed = parseSizedAlt(alt);
    if (!parsed) return;
    const existing = nodePreviewWidth(node.attrs as Record<string, unknown>);
    updates.push({
      pos,
      alt: parsed.name,
      width: existing ?? parsed.previewWidth,
    });
  });
  if (updates.length === 0) return;

  editor
    .chain()
    .command(({ tr }) => {
      for (const u of updates) {
        const node = tr.doc.nodeAt(u.pos);
        if (!node || node.type.name !== "image") continue;
        tr.setNodeMarkup(u.pos, undefined, {
          ...node.attrs,
          alt: u.alt,
          width: u.width,
        });
      }
      return true;
    })
    .run();
}

function cellHasColor(attrs: Record<string, unknown>): boolean {
  const bg = attrs.backgroundColor;
  const text = attrs.textColor;
  const meaningful = (v: unknown) =>
    typeof v === "string" && v.length > 0 && v !== "default";
  return meaningful(bg) || meaningful(text);
}

function tableHasColors(table: {
  descendants: (f: (node: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void;
}): boolean {
  let found = false;
  table.descendants((node) => {
    if (found) return;
    if (
      node.type.name === "tableCell" ||
      node.type.name === "tableHeader"
    ) {
      if (cellHasColor(node.attrs)) found = true;
    }
  });
  return found;
}

/**
 * Per-table HTML (or null) in document order for `applyColoredTableHtml`.
 * Only colored tables produce HTML; plain GFM tables stay as markdown.
 */
export function projectColoredTablesFromTiptap(
  editor: Editor,
): Array<string | null> {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const out: Array<string | null> = [];

  editor.state.doc.descendants((node) => {
    if (node.type.name !== "table") return;
    if (!tableHasColors(node)) {
      out.push(null);
      return false;
    }
    const dom = serializer.serializeNode(node);
    if (!(dom instanceof HTMLElement)) {
      out.push(null);
      return false;
    }
    out.push(dom.outerHTML);
    return false;
  });

  return out;
}
