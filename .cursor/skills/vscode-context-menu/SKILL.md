---
name: vscode-context-menu
description: >-
  Builds VS Code / Cursor-style context menus for MarkSpace: text-first rows,
  optional monochrome icons, compact separators, neutral hover. Use when creating
  or restyling a context menu, tree menu, right-click menu, or when the user asks
  for a menu like VS Code / Cursor (контекстное меню, без иконок, monochrome icons).
---

# VS Code–style context menus

Reference implementation: `TreeContextMenu` in `src/components/FileTree.tsx` +
`.tree-context-menu` / `.tree-context-item` / `.is-plaintext` in `src/App.css`.

Also follow `dropdown-menus.mdc` (neutral panel, no accent fill on items) and
`ui-language.mdc` (English labels).

## Default: text only

- **No leading icons** unless the user explicitly asks to add icons for that menu.
- Label is plain text (no `<span>` wrapper required).
- Submenus: label + right-side chevron only (`MdChevronRight`, class `tree-context-chevron`).
- Group related actions; put a `.tree-context-sep` between groups.
- Destructive action: last group, class `is-danger` on the item.

## When the user asks for icons

If (and only if) the user **specifically** requests icons on this kind of menu:

- Use **monochrome** icons in Visual Studio Code style — not Flat Color (`react-icons/fc`), not colorful glyphs.
- Prefer outline / stroke SVGs with `currentColor` (Codicons-like, or thin `react-icons/md` / custom 16×16 paths).
- Size **16** in the menu row.
- Do **not** tint with `--accent`; icon inherits item text color (including `.is-danger` and disabled opacity).
- Keep a fixed leading gutter so labels align whether a row has an icon or not (see padding below).
- Do not mix Flat Color and monochrome in the same menu.

## Layout & CSS

Reuse existing classes when possible:

| Class | Role |
| --- | --- |
| `tree-context-menu` | Portal panel (`position: fixed`, `z-index: 1100`) |
| `tree-context-menu.is-plaintext` | Text-first padding (left gutter ~28px) |
| `tree-context-item` | Row button `role="menuitem"` |
| `tree-context-sep` | Full-bleed 1px separator |
| `tree-context-submenu-wrap` / `tree-context-submenu` | Flyout submenu |
| `tree-context-chevron` | `margin-left: auto` on parent row |

Targets (match current plaintext tree menu):

- Panel: tight radius (~5px), light border `var(--line)`, soft shadow, `padding: 4px 0`, surface `var(--editor-surface)`.
- Item: ~`0.8125rem`, vertical padding ~5px, **left padding ~28px** when text-only (empty icon gutter like VS Code).
- With icons: left padding smaller (~8–10px), icon in a ~16–18px slot, then label; all labels share the same text start column.
- Hover: `var(--menu-item-hover)` — never accent blue fill (product menus stay neutral).
- Disabled: opacity ~0.4, no pointer events.
- Separators: full width (`margin` vertical only).

## Structure checklist

1. Portal to `document.body`; close on outside pointerdown, Escape, scroll.
2. Clamp `left` / `top` to the viewport.
3. Build sections as arrays; insert separators between non-empty sections.
4. Submenu open on hover (and click toggle as fallback).
5. UI copy in English; ellipsis `…` on actions that open a dialog.

## Anti-patterns

- Flat Color / multicolor icons in a VS Code–style menu.
- Accent-colored selected/hover rows.
- Icon gutter on some rows but not others (misaligned labels).
- Cards, heavy shadows, large radius, or dashboard-like chrome.
- Adding icons “for consistency” without an explicit user request.
