# MarkSpace

Local Markdown vault with a Notion-like block editor.

Your notes are ordinary `.md` files in a folder. Open the same vault in VS Code or Cursor and edit them as text. MarkSpace watches the folder and reloads external changes.

## Features (v0.1)

- Open any local folder as a vault
- Sidebar file tree (create / delete notes)
- TipTap block editor with `/` slash commands
- Saves clean Markdown to disk (debounced + Ctrl/Cmd+S)
- Wiki-links: `[[Note]]`, `[[Note|alias]]`
- External links: `[Example](https://example.com)`
- Auto-creates `Welcome.md` and `.markspace/config.json` for empty vaults

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
```

Hidden folders (names starting with `.`) are ignored by the sidebar.

## Linking

| In Markdown | Behavior |
|---|---|
| `[[Welcome]]` | Opens / creates note by name |
| `[[projects/ideas\|Ideas]]` | Wiki-link with alias |
| `[Site](https://example.com)` | Opens in system browser |
| `[Local](./Welcome.md)` | Opens local note when possible |

## Stack

Tauri 2 · React · TypeScript · TipTap · Zustand
