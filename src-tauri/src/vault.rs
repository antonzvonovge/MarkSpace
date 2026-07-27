use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<TreeNode>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultChange {
    pub kind: String,
    pub path: String,
}

pub struct VaultState {
    pub root: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            root: Mutex::new(None),
            watcher: Mutex::new(None),
        }
    }
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn ensure_inside(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve vault root: {e}"))?;
    let full = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };

    // Reject `..` components before canonicalize for non-existing targets
    for component in full.components() {
        if matches!(component, Component::ParentDir) {
            return Err("Path escapes vault".into());
        }
    }

    if full.exists() {
        let canon = full
            .canonicalize()
            .map_err(|e| format!("Cannot resolve path: {e}"))?;
        if !canon.starts_with(&root) {
            return Err("Path escapes vault".into());
        }
        return Ok(canon);
    }

    if let Some(parent) = full.parent() {
        if parent.exists() {
            let parent_canon = parent
                .canonicalize()
                .map_err(|e| format!("Cannot resolve parent: {e}"))?;
            if !parent_canon.starts_with(&root) {
                return Err("Path escapes vault".into());
            }
        }
    }

    Ok(full)
}

fn relative_to_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

fn build_tree(root: &Path, dir: &Path) -> Result<Vec<TreeNode>, String> {
    let mut entries: Vec<TreeNode> = Vec::new();

    let read = fs::read_dir(dir).map_err(|e| format!("Cannot read directory: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Cannot read entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if is_hidden(&name) {
            continue;
        }

        let path = entry.path();
        let is_dir = path.is_dir();
        let rel = relative_to_root(root, &path);

        if is_dir {
            let children = build_tree(root, &path)?;
            entries.push(TreeNode {
                name,
                path: rel,
                is_dir: true,
                children: Some(children),
            });
        } else if name.ends_with(".md") {
            entries.push(TreeNode {
                name,
                path: rel,
                is_dir: false,
                children: None,
            });
        }
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

fn get_root(state: &VaultState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "Vault state lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No vault open".to_string())
}

#[tauri::command]
pub fn open_vault(path: String, state: State<VaultState>, app: AppHandle) -> Result<TreeNode, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("Selected path is not a directory".into());
    }

    let root = root
        .canonicalize()
        .map_err(|e| format!("Cannot open vault: {e}"))?;

    // Ensure .markspace exists
    let markspace = root.join(".markspace");
    if !markspace.exists() {
        fs::create_dir_all(&markspace).map_err(|e| format!("Cannot create .markspace: {e}"))?;
        let config = markspace.join("config.json");
        if !config.exists() {
            fs::write(&config, "{\n  \"version\": 1\n}\n")
                .map_err(|e| format!("Cannot write config: {e}"))?;
        }
    }

    // Seed welcome note if vault is empty of markdown
    let has_md = WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .any(|e| {
            let p = e.path();
            p.is_file()
                && p.extension().and_then(|x| x.to_str()) == Some("md")
                && !p
                    .components()
                    .any(|c| matches!(c, Component::Normal(n) if n.to_string_lossy().starts_with('.')))
        });

    if !has_md {
        let welcome = root.join("Welcome.md");
        fs::write(
            &welcome,
            "# Welcome to MarkSpace\n\nThis vault is a regular folder of Markdown files.\n\n- Edit here with Notion-like blocks\n- Or open the same files in VS Code / Cursor\n- Link notes with [[Welcome]] wiki-links\n- Link out with [external URLs](https://example.com)\n",
        )
        .map_err(|e| format!("Cannot create Welcome.md: {e}"))?;
    }

    {
        let mut guard = state.root.lock().map_err(|_| "Vault state lock poisoned")?;
        *guard = Some(root.clone());
    }

    start_watcher(app, &state, &root)?;

    let children = build_tree(&root, &root)?;
    Ok(TreeNode {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "vault".into()),
        path: String::new(),
        is_dir: true,
        children: Some(children),
    })
}

fn start_watcher(app: AppHandle, state: &VaultState, root: &Path) -> Result<(), String> {
    let root_for_cb = root.to_path_buf();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                for path in event.paths {
                    if path
                        .components()
                        .any(|c| matches!(c, Component::Normal(n) if n.to_string_lossy().starts_with('.')))
                    {
                        continue;
                    }
                    let rel = relative_to_root(&root_for_cb, &path);
                    let kind = format!("{:?}", event.kind);
                    let _ = app.emit(
                        "vault-change",
                        VaultChange {
                            kind,
                            path: rel,
                        },
                    );
                }
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(500)),
    )
    .map_err(|e| format!("Cannot start watcher: {e}"))?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| format!("Cannot watch vault: {e}"))?;

    let mut guard = state.watcher.lock().map_err(|_| "Watcher lock poisoned")?;
    *guard = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn list_tree(state: State<VaultState>) -> Result<TreeNode, String> {
    let root = get_root(&state)?;
    let children = build_tree(&root, &root)?;
    Ok(TreeNode {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "vault".into()),
        path: String::new(),
        is_dir: true,
        children: Some(children),
    })
}

#[tauri::command]
pub fn read_note(path: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let full = ensure_inside(&root, Path::new(&path))?;
    if !full.is_file() {
        return Err("Note not found".into());
    }
    fs::read_to_string(&full).map_err(|e| format!("Cannot read note: {e}"))
}

#[tauri::command]
pub fn write_note(path: String, content: String, state: State<VaultState>) -> Result<(), String> {
    let root = get_root(&state)?;
    let full = ensure_inside(&root, Path::new(&path))?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;
    }
    fs::write(&full, content).map_err(|e| format!("Cannot write note: {e}"))
}

#[tauri::command]
pub fn create_note(path: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let mut rel = path.trim().trim_start_matches('/').to_string();
    if !rel.ends_with(".md") {
        rel.push_str(".md");
    }
    let full = ensure_inside(&root, Path::new(&rel))?;
    if full.exists() {
        return Err("Note already exists".into());
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;
    }
    let stem = full
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".into());
    let content = format!("# {stem}\n\n");
    fs::write(&full, content).map_err(|e| format!("Cannot create note: {e}"))?;
    Ok(relative_to_root(&root, &full))
}

#[tauri::command]
pub fn create_folder(path: String, state: State<VaultState>) -> Result<(), String> {
    let root = get_root(&state)?;
    let rel = path.trim().trim_start_matches('/');
    let full = ensure_inside(&root, Path::new(rel))?;
    fs::create_dir_all(&full).map_err(|e| format!("Cannot create folder: {e}"))
}

#[tauri::command]
pub fn rename_path(from: String, to: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let from_full = ensure_inside(&root, Path::new(&from))?;
    let mut to_rel = to.trim().trim_start_matches('/').to_string();
    if from_full.is_file() && !to_rel.ends_with(".md") {
        to_rel.push_str(".md");
    }
    let to_full = ensure_inside(&root, Path::new(&to_rel))?;
    if to_full.exists() {
        return Err("Target already exists".into());
    }
    if let Some(parent) = to_full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;
    }
    fs::rename(&from_full, &to_full).map_err(|e| format!("Cannot rename: {e}"))?;
    Ok(relative_to_root(&root, &to_full))
}

#[tauri::command]
pub fn delete_path(path: String, state: State<VaultState>) -> Result<(), String> {
    let root = get_root(&state)?;
    let full = ensure_inside(&root, Path::new(&path))?;
    if full.is_dir() {
        fs::remove_dir_all(&full).map_err(|e| format!("Cannot delete folder: {e}"))
    } else {
        fs::remove_file(&full).map_err(|e| format!("Cannot delete file: {e}"))
    }
}

#[tauri::command]
pub fn resolve_wiki_target(target: String, state: State<VaultState>) -> Result<Option<String>, String> {
    let root = get_root(&state)?;
    let target = target.trim().trim_start_matches('/');
    let direct = if target.ends_with(".md") {
        target.to_string()
    } else {
        format!("{target}.md")
    };

    let direct_path = ensure_inside(&root, Path::new(&direct))?;
    if direct_path.is_file() {
        return Ok(Some(relative_to_root(&root, &direct_path)));
    }

    // Fuzzy: match by stem anywhere in vault
    let needle = Path::new(target)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| target.to_string())
        .to_lowercase();

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path
            .components()
            .any(|c| matches!(c, Component::Normal(n) if n.to_string_lossy().starts_with('.')))
        {
            continue;
        }
        if path.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if stem.to_lowercase() == needle {
            return Ok(Some(relative_to_root(&root, path)));
        }
    }

    Ok(None)
}

#[tauri::command]
pub fn get_vault_path(state: State<VaultState>) -> Result<Option<String>, String> {
    let guard = state.root.lock().map_err(|_| "Vault state lock poisoned")?;
    Ok(guard.as_ref().map(|p| p.to_string_lossy().to_string()))
}
