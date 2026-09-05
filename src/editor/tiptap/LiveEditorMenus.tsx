/**
 * Live slash (`/` + Ctrl+Space) and `#` tag suggestion controllers.
 * Mount only while the editor is active; menus portal when open.
 */

import type { Editor } from "@tiptap/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getTagMenuItems } from "../tag/tagSuggestion";
import {
  caretClientRect,
  SuggestionPortal,
  type SuggestionRow,
} from "./SuggestionPortal";
import {
  buildSlashMenuItems,
  filterSlashMenuItems,
  type WikiLinkPickerOpenOpts,
} from "./slashMenuItems";
import { findSlashTrigger, findTagTrigger } from "./triggerDetect";

type PaletteState = {
  query: string;
  insertPos: number;
  anchor: DOMRect;
};

type DocMenuState = {
  from: number;
  to: number;
  query: string;
  anchor: DOMRect;
};

type Props = {
  editor: Editor | null;
  notePath: string;
  openWikiLinkPicker: (opts: WikiLinkPickerOpenOpts) => void;
  /** When false (keep-alive tab), skip listeners. */
  active?: boolean;
};

export function LiveEditorMenus({
  editor,
  notePath,
  openWikiLinkPicker,
  active = true,
}: Props) {
  const [slashDoc, setSlashDoc] = useState<DocMenuState | null>(null);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [tagMenu, setTagMenu] = useState<DocMenuState | null>(null);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  const openWikiLinkPickerRef = useRef(openWikiLinkPicker);
  openWikiLinkPickerRef.current = openWikiLinkPicker;

  const slashCatalog = useMemo(
    () =>
      buildSlashMenuItems({
        openWikiLinkPicker: (opts) => openWikiLinkPickerRef.current(opts),
      }),
    [],
  );

  const syncDocMenus = useCallback(() => {
    if (!editor || paletteRef.current) {
      setSlashDoc((prev) => (prev ? null : prev));
      setTagMenu((prev) => (prev ? null : prev));
      return;
    }
    const dom = editor.view.dom;
    const slash = findSlashTrigger(editor.state);
    if (slash) {
      const anchor = caretClientRect(dom);
      setSlashDoc((prev) => {
        if (
          prev &&
          prev.from === slash.from &&
          prev.to === slash.to &&
          prev.query === slash.query
        ) {
          return prev;
        }
        return {
          from: slash.from,
          to: slash.to,
          query: slash.query,
          anchor,
        };
      });
      setTagMenu((prev) => (prev ? null : prev));
      return;
    }
    setSlashDoc((prev) => (prev ? null : prev));
    const tag = findTagTrigger(editor.state);
    if (tag) {
      const anchor = caretClientRect(dom);
      setTagMenu((prev) => {
        if (
          prev &&
          prev.from === tag.from &&
          prev.to === tag.to &&
          prev.query === tag.query
        ) {
          return prev;
        }
        return {
          from: tag.from,
          to: tag.to,
          query: tag.query,
          anchor,
        };
      });
      return;
    }
    setTagMenu((prev) => (prev ? null : prev));
  }, [editor]);

  const openPalette = useCallback(() => {
    if (!editor) return;
    const pos = editor.state.selection.from;
    setSlashDoc(null);
    setTagMenu(null);
    setPalette({
      query: "",
      insertPos: pos,
      anchor: caretClientRect(editor.view.dom),
    });
  }, [editor]);

  useEffect(() => {
    if (!editor || !active) return;
    const onUpdate = () => syncDocMenus();
    editor.on("selectionUpdate", onUpdate);
    editor.on("update", onUpdate);
    syncDocMenus();
    return () => {
      editor.off("selectionUpdate", onUpdate);
      editor.off("update", onUpdate);
    };
  }, [editor, active, syncDocMenus]);

  useEffect(() => {
    if (!editor || !active) return;
    const open = () => openPalette();
    // Bridged from layoutAgnosticKeymap via DOM event (avoids remounting keymap).
    const dom = editor.view.dom;
    const handler = (e: Event) => {
      e.preventDefault();
      open();
    };
    dom.addEventListener("markspace-open-slash-palette", handler);
    return () => {
      dom.removeEventListener("markspace-open-slash-palette", handler);
    };
  }, [editor, active, openPalette]);

  const closePalette = useCallback(() => setPalette(null), []);
  const closeSlashDoc = useCallback(() => setSlashDoc(null), []);
  const closeTag = useCallback(() => setTagMenu(null), []);

  const runSlashItem = useCallback(
    async (id: string, deleteRange: { from: number; to: number } | null) => {
      if (!editor) return;
      const item = slashCatalog.find((i) => i.id === id);
      if (!item) return;
      if (deleteRange && deleteRange.to > deleteRange.from) {
        editor
          .chain()
          .focus()
          .deleteRange({ from: deleteRange.from, to: deleteRange.to })
          .run();
      } else {
        editor.chain().focus().run();
      }
      setPalette(null);
      setSlashDoc(null);
      try {
        await item.run(editor, notePath);
      } catch (err) {
        console.error("Slash command failed", err);
      }
    },
    [editor, notePath, slashCatalog],
  );

  const applyTag = useCallback(
    (tagName: string, range: { from: number; to: number }) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: range.from, to: range.to })
        .insertContent(`#${tagName} `)
        .run();
      setTagMenu(null);
    },
    [editor],
  );

  const slashQuery = palette?.query ?? slashDoc?.query ?? "";
  const slashItemsFiltered = useMemo(
    () => filterSlashMenuItems(slashCatalog, slashQuery),
    [slashCatalog, slashQuery],
  );
  const slashRows: SuggestionRow[] = useMemo(
    () =>
      slashItemsFiltered.map((i) => ({
        id: i.id,
        title: i.title,
        subtext: i.subtext,
        group: i.group,
        icon: i.icon,
      })),
    [slashItemsFiltered],
  );

  const tagItems = useMemo(
    () => (tagMenu ? getTagMenuItems(tagMenu.query) : []),
    [tagMenu],
  );
  const tagRows: SuggestionRow[] = useMemo(
    () => tagItems.map((t) => ({ id: t.id, title: t.title })),
    [tagItems],
  );

  const onPaletteKeyDown = useCallback((e: KeyboardEvent): boolean => {
    if (e.key === "Escape") return false;
    if (e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      setPalette((p) => {
        if (!p) return p;
        if (!p.query) {
          return null;
        }
        return { ...p, query: p.query.slice(0, -1) };
      });
      return true;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      setPalette((p) => (p ? { ...p, query: p.query + e.key } : p));
      return true;
    }
    return false;
  }, []);

  if (!active || !editor) return null;

  return (
    <>
      {palette ? (
        <SuggestionPortal
          items={slashRows}
          anchorRect={palette.anchor}
          ariaLabel="Insert block"
          onClose={closePalette}
          onSelect={(id) => void runSlashItem(id, null)}
          onKeyDownCapture={onPaletteKeyDown}
        />
      ) : null}
      {!palette && slashDoc ? (
        <SuggestionPortal
          items={slashRows}
          anchorRect={slashDoc.anchor}
          ariaLabel="Insert block"
          onClose={closeSlashDoc}
          onSelect={(id) =>
            void runSlashItem(id, { from: slashDoc.from, to: slashDoc.to })
          }
        />
      ) : null}
      {!palette && !slashDoc && tagMenu ? (
        <SuggestionPortal
          items={tagRows}
          anchorRect={tagMenu.anchor}
          ariaLabel="Tags"
          compact
          emptyLabel="No matching tags"
          onClose={closeTag}
          onSelect={(id) => {
            const item = tagItems.find((t) => t.id === id);
            if (!item) return;
            applyTag(item.tagName, { from: tagMenu.from, to: tagMenu.to });
          }}
        />
      ) : null}
    </>
  );
}
