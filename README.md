# MarkSpace

Local Markdown vault with a Notion-like block editor.

Your notes are ordinary `.md` files in a folder. Open the same vault in VS Code or Cursor and edit them as text. MarkSpace watches the folder and reloads external changes.

## Features (v0.1)

- Open any local folder as a vault
- Sidebar file tree with visible root folder
- Create notes and folders in the selected folder (root if none)
- Drag-and-drop to reorder siblings and move into folders
- TipTap block editor with `/` slash commands
- Saves clean Markdown to disk (debounced + Ctrl/Cmd+S)
- Wiki-links: `[[Note]]`, `[[Note|alias]]`
- External links: `[Example](https://example.com)`
- Auto-creates `Welcome.md` and `.markspace/` for empty vaults

## Run

Prerequisites: Node.js, Rust, and [Tauri Linux deps](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

## Vault layout

```text
my-vault/
  Welcome.md
  projects/
    ideas.md
  .markspace/
    config.json
    order.json
```

Hidden folders (names starting with `.`) are ignored by the sidebar.

### Custom order

Sibling order is stored in `.markspace/order.json`:

```json
{
  "": ["Welcome.md", "projects"],
  "projects": ["ideas.md"]
}
```

Keys are folder paths relative to the vault (`""` = root). Values are child names in display order. Unknown files still appear (appended). Moving via drag-and-drop updates this file and renames on disk when the parent changes.

Expand/collapse state is **not** stored in the vault — it lives in the app settings so git stays clean. The root folder is always expanded.

## Linking

| In Markdown | Behavior |
|---|---|
| `[[Welcome]]` | Opens / creates note by name |
| `[[projects/ideas\|Ideas]]` | Wiki-link with alias |
| `[Site](https://example.com)` | Opens in system browser |
| `[Local](./Welcome.md)` | Opens local note when possible |

## Stack

Tauri 2 · React · TypeScript · TipTap · Zustand · [@minoru/react-dnd-treeview](https://github.com/minop1205/react-dnd-treeview)
