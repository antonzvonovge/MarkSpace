# MarkSpace

Local Markdown vault with a Notion-like block editor.

Your notes are ordinary `.md` files in a folder. Open the same vault in VS Code or Cursor and edit them as text. MarkSpace watches the folder and reloads external changes.

## Features

- Open any local folder as a vault
- Sidebar file tree with visible root folder
- Create notes and folders in the selected folder (root if none)
- Drag-and-drop to reorder siblings and move into folders
- BlockNote editor with `/` slash commands
- Saves clean Markdown to disk (debounced + Ctrl/Cmd+S)
- Wiki-links: `[[Note]]`, `[[Note|alias]]`
- External links: `[Example](https://example.com)`
- Auto-creates `Welcome.md` and `.markspace/` for empty vaults
- **GitHub sync** via built-in git (no separate Git install) — Settings → Sync



## Run

Prerequisites: Node.js, Rust, and [Tauri Linux deps](https://tauri.app/start/prerequisites/). Building with GitHub sync also needs a C toolchain (libgit2 is vendored; OpenSSL may be required for HTTPS).

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

Hidden folders and files (names starting with `.`) are ignored by the sidebar. After you connect sync, the vault becomes a normal git repository (`.git/` stays hidden from the tree).

Each folder can have a hidden **folder note** at `{folder}/.folder.md`. It is not shown in the tree; clicking the folder in the sidebar creates it (if missing) and opens it as the folder overview. Wiki-links to a folder name (e.g. `[[projects]]`) resolve to that note.

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

## GitHub sync

MarkSpace can sync the open vault with a GitHub repository using an embedded git client (`libgit2`). You do **not** need to install Git separately.

1. Create a GitHub repo (prefer **private** for personal notes).
2. Open your vault in MarkSpace.
3. Open **Settings → Sync** (or the sync icon in the sidebar footer).
4. Sign in:
  - **Personal Access Token** (always available): classic token with `repo` scope, or a fine-grained token with Contents read/write on that repository. The token is stored only on this machine.
  - **Sign in with GitHub** (Device Flow): available when the app is built with `MARKSPACE_GITHUB_CLIENT_ID` set to a GitHub OAuth App client id.
5. Enter the repo URL or `owner/repo`, then **Connect**.
6. Use **Sync Now** (or the status bar menu → Synchronize) to commit local changes, pull, and push.
7. Optionally enable **Auto-sync** (5 / 15 / 30 / 60 minutes). While the app is open it syncs on that interval and when you return to the window.

Conflicts appear in Settings → Sync and as a banner in the editor. Markdown (`.md`) conflicts are resolved automatically by keeping both sides. Draw.io (`.drawio`) diagrams are never auto-merged — choose **Keep mine** or **Keep theirs**. For other remaining conflicts choose **Keep both**, **Keep mine** / **Keep theirs**, or open the file and edit conflict markers manually, then sync again.

App UI prefs (theme, fonts, last vault path, tree expand state) stay on the device and are not synced. Sync connection (remote URL, auto-sync interval) is stored per vault in the app settings file (`githubSync.byVault`); the GitHub token is machine-local and shared across vaults.

### Device Flow (optional, for maintainers)

Register a GitHub OAuth App, enable Device Flow, then build with:

```bash
MARKSPACE_GITHUB_CLIENT_ID=Iv1.xxxxxxxx npm run tauri build
```

Without this, users authenticate with a Personal Access Token.

## Linking


| In Markdown                   | Behavior                       |
| ----------------------------- | ------------------------------ |
| `[[Welcome]]`                 | Opens / creates note by name   |
| `[[projects/ideas             | Ideas]]`                       |
| `[Site](https://example.com)` | Opens in system browser        |
| `[Local](./Welcome.md)`       | Opens local note when possible |


Full dialect (embeds, image widths, tables, diagrams, unsupported syntax): [docs/markdown-format.md](docs/markdown-format.md).

## Stack

Tauri 2 · React · TypeScript · BlockNote · Zustand · git2 · [@minoru/react-dnd-treeview](https://github.com/minop1205/react-dnd-treeview)