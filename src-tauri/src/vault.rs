use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
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

type OrderMap = HashMap<String, Vec<String>>;

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

fn parent_rel(path: &str) -> String {
    let path = path.trim_matches('/');
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

fn entry_name(path: &str) -> String {
    let path = path.trim_matches('/');
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn join_parent(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn order_path(root: &Path) -> PathBuf {
    root.join(".markspace").join("order.json")
}

fn read_order(root: &Path) -> OrderMap {
    let path = order_path(root);
    let Ok(raw) = fs::read_to_string(&path) else {
        return OrderMap::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return OrderMap::new();
    };
    let Some(obj) = value.as_object() else {
        return OrderMap::new();
    };
    let mut map = OrderMap::new();
    for (k, v) in obj {
        if let Some(arr) = v.as_array() {
            let names: Vec<String> = arr
                .iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect();
            map.insert(k.clone(), names);
        }
    }
    map
}

fn write_order(root: &Path, order: &OrderMap) -> Result<(), String> {
    let markspace = root.join(".markspace");
    fs::create_dir_all(&markspace).map_err(|e| format!("Cannot create .markspace: {e}"))?;
    let path = order_path(root);
    let mut sorted_keys: Vec<&String> = order.keys().collect();
    sorted_keys.sort();
    let mut obj = serde_json::Map::new();
    for key in sorted_keys {
        if let Some(names) = order.get(key) {
            if names.is_empty() {
                continue;
            }
            obj.insert(
                key.clone(),
                Value::Array(names.iter().map(|n| Value::String(n.clone())).collect()),
            );
        }
    }
    let pretty = serde_json::to_string_pretty(&Value::Object(obj))
        .map_err(|e| format!("Cannot serialize order: {e}"))?;
    fs::write(&path, format!("{pretty}\n")).map_err(|e| format!("Cannot write order: {e}"))
}

fn sort_entries(entries: &mut [TreeNode], preferred: &[String]) {
    let mut rank: HashMap<&str, usize> = HashMap::new();
    for (i, name) in preferred.iter().enumerate() {
        rank.insert(name.as_str(), i);
    }

    entries.sort_by(|a, b| {
        let ra = rank.get(a.name.as_str());
        let rb = rank.get(b.name.as_str());
        match (ra, rb) {
            (Some(i), Some(j)) => i.cmp(j),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            },
        }
    });
}

fn build_tree(root: &Path, dir: &Path, order: &OrderMap) -> Result<Vec<TreeNode>, String> {
    let mut entries: Vec<TreeNode> = Vec::new();
    let dir_rel = relative_to_root(root, dir);

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
            let children = build_tree(root, &path, order)?;
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

    let preferred = order.get(&dir_rel).cloned().unwrap_or_default();
    sort_entries(&mut entries, &preferred);
    Ok(entries)
}

fn make_root_node(root: &Path, order: &OrderMap) -> Result<TreeNode, String> {
    let children = build_tree(root, root, order)?;
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

fn get_root(state: &VaultState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "Vault state lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No vault open".to_string())
}

fn materialize_parent_order(root: &Path, order: &mut OrderMap, parent: &str) -> Result<(), String> {
    let dir = if parent.is_empty() {
        root.to_path_buf()
    } else {
        ensure_inside(root, Path::new(parent))?
    };
    if !dir.is_dir() {
        return Ok(());
    }

    let mut names: Vec<String> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("Cannot read directory: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Cannot read entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if is_hidden(&name) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() || name.ends_with(".md") {
            names.push(name);
        }
    }

    let preferred = order.get(parent).cloned().unwrap_or_default();
    names.sort_by(|a, b| {
        let ra = preferred.iter().position(|n| n == a);
        let rb = preferred.iter().position(|n| n == b);
        match (ra, rb) {
            (Some(i), Some(j)) => i.cmp(&j),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => {
                let a_dir = dir.join(a).is_dir();
                let b_dir = dir.join(b).is_dir();
                match (a_dir, b_dir) {
                    (true, false) => std::cmp::Ordering::Less,
                    (false, true) => std::cmp::Ordering::Greater,
                    _ => a.to_lowercase().cmp(&b.to_lowercase()),
                }
            }
        }
    });

    if names.is_empty() {
        order.remove(parent);
    } else {
        order.insert(parent.to_string(), names);
    }
    Ok(())
}

fn order_remove_child(order: &mut OrderMap, parent: &str, name: &str) {
    if let Some(list) = order.get_mut(parent) {
        list.retain(|n| n != name);
        if list.is_empty() {
            order.remove(parent);
        }
    }
}

fn order_insert_child(order: &mut OrderMap, parent: &str, name: &str, index: Option<usize>) {
    let list = order.entry(parent.to_string()).or_default();
    list.retain(|n| n != name);
    let idx = index.unwrap_or(list.len()).min(list.len());
    list.insert(idx, name.to_string());
}

fn order_remove_subtree(order: &mut OrderMap, folder_path: &str) {
    let prefix = if folder_path.is_empty() {
        String::new()
    } else {
        format!("{folder_path}/")
    };
    order.retain(|k, _| {
        if folder_path.is_empty() {
            k.is_empty()
        } else {
            k != folder_path && !k.starts_with(&prefix)
        }
    });
    if folder_path.is_empty() {
        order.clear();
    }
}

fn rewrite_order_keys_after_move(order: &mut OrderMap, from: &str, to: &str) {
    if from.is_empty() {
        return;
    }
    let from_prefix = format!("{from}/");
    let mut updates: Vec<(String, Vec<String>)> = Vec::new();
    let mut remove_keys: Vec<String> = Vec::new();

    for (key, names) in order.iter() {
        if key == from || key.starts_with(&from_prefix) {
            let suffix = if key == from {
                String::new()
            } else {
                key[from.len() + 1..].to_string()
            };
            let new_key = if suffix.is_empty() {
                to.to_string()
            } else {
                format!("{to}/{suffix}")
            };
            updates.push((new_key, names.clone()));
            remove_keys.push(key.clone());
        }
    }

    for key in remove_keys {
        order.remove(&key);
    }
    for (key, names) in updates {
        order.insert(key, names);
    }
}

fn is_descendant_or_same(ancestor: &str, maybe_child: &str) -> bool {
    if ancestor.is_empty() {
        return false;
    }
    maybe_child == ancestor || maybe_child.starts_with(&format!("{ancestor}/"))
}

#[tauri::command]
pub fn open_vault(
    path: String,
    state: State<VaultState>,
    app: AppHandle,
) -> Result<TreeNode, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("Selected path is not a directory".into());
    }

    let root = root
        .canonicalize()
        .map_err(|e| format!("Cannot open vault: {e}"))?;

    let markspace = root.join(".markspace");
    if !markspace.exists() {
        fs::create_dir_all(&markspace).map_err(|e| format!("Cannot create .markspace: {e}"))?;
        let config = markspace.join("config.json");
        if !config.exists() {
            fs::write(&config, "{\n  \"version\": 1\n}\n")
                .map_err(|e| format!("Cannot write config: {e}"))?;
        }
    }

    let has_md = WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .any(|e| {
            let p = e.path();
            p.is_file()
                && p.extension().and_then(|x| x.to_str()) == Some("md")
                && !p.components().any(
                    |c| matches!(c, Component::Normal(n) if n.to_string_lossy().starts_with('.')),
                )
        });

    if !has_md {
        let welcome = root.join("Welcome.md");
        fs::write(
            &welcome,
            "# Welcome to MarkSpace\n\nThis vault is a regular folder of Markdown files.\n\n- Edit here with Notion-like blocks\n- Or open the same files in VS Code / Cursor\n- Link notes with [[Welcome]] wiki-links\n- Link out with [external URLs](https://example.com)\n",
        )
        .map_err(|e| format!("Cannot create Welcome.md: {e}"))?;
        let mut order = read_order(&root);
        order_insert_child(&mut order, "", "Welcome.md", None);
        write_order(&root, &order)?;
    }

    {
        let mut guard = state.root.lock().map_err(|_| "Vault state lock poisoned")?;
        *guard = Some(root.clone());
    }

    start_watcher(app, &state, &root)?;
    let order = read_order(&root);
    make_root_node(&root, &order)
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
    let order = read_order(&root);
    make_root_node(&root, &order)
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

    let created = relative_to_root(&root, &full);
    let parent = parent_rel(&created);
    let name = entry_name(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(created)
}

#[tauri::command]
pub fn create_folder(path: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let rel = path.trim().trim_start_matches('/').to_string();
    if rel.is_empty() {
        return Err("Folder name required".into());
    }
    let full = ensure_inside(&root, Path::new(&rel))?;
    if full.exists() {
        return Err("Folder already exists".into());
    }
    fs::create_dir_all(&full).map_err(|e| format!("Cannot create folder: {e}"))?;

    let created = relative_to_root(&root, &full);
    let parent = parent_rel(&created);
    let name = entry_name(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(created)
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

    let from_rel = relative_to_root(&root, &from_full);
    let from_parent = parent_rel(&from_rel);
    let from_name = entry_name(&from_rel);
    let was_dir = from_full.is_dir();

    fs::rename(&from_full, &to_full).map_err(|e| format!("Cannot rename: {e}"))?;
    let to_rel = relative_to_root(&root, &to_full);
    let to_parent = parent_rel(&to_rel);
    let to_name = entry_name(&to_rel);

    let mut order = read_order(&root);
    order_remove_child(&mut order, &from_parent, &from_name);
    order_insert_child(&mut order, &to_parent, &to_name, None);
    if was_dir {
        rewrite_order_keys_after_move(&mut order, &from_rel, &to_rel);
    }
    write_order(&root, &order)?;

    Ok(to_rel)
}

#[tauri::command]
pub fn move_entry(
    from: String,
    to_parent: String,
    to_index: usize,
    state: State<VaultState>,
) -> Result<String, String> {
    let root = get_root(&state)?;
    let from = from.trim().trim_start_matches('/').to_string();
    let to_parent = to_parent.trim().trim_start_matches('/').to_string();

    if from.is_empty() {
        return Err("Cannot move vault root".into());
    }
    if is_descendant_or_same(&from, &to_parent) {
        return Err("Cannot move a folder into itself".into());
    }

    let from_full = ensure_inside(&root, Path::new(&from))?;
    if !from_full.exists() {
        return Err("Source not found".into());
    }

    let name = entry_name(&from);
    let from_parent = parent_rel(&from);
    let was_dir = from_full.is_dir();
    let new_rel = join_parent(&to_parent, &name);
    let same_parent = from_parent == to_parent;

    if !same_parent {
        let to_full = ensure_inside(&root, Path::new(&new_rel))?;
        if to_full.exists() {
            return Err("Target already exists".into());
        }
        if let Some(parent) = to_full.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;
        }
        fs::rename(&from_full, &to_full).map_err(|e| format!("Cannot move: {e}"))?;
    }

    let mut order = read_order(&root);
    materialize_parent_order(&root, &mut order, &from_parent)?;
    if !same_parent {
        materialize_parent_order(&root, &mut order, &to_parent)?;
    }

    if same_parent {
        let list = order.entry(from_parent.clone()).or_default();
        list.retain(|n| n != &name);
        let idx = to_index.min(list.len());
        list.insert(idx, name.clone());
    } else {
        order_remove_child(&mut order, &from_parent, &name);
        // After FS rename, materialize again so missing/new are correct, then insert
        materialize_parent_order(&root, &mut order, &to_parent)?;
        order_insert_child(&mut order, &to_parent, &name, Some(to_index));
        if was_dir {
            rewrite_order_keys_after_move(&mut order, &from, &new_rel);
        }
    }
    write_order(&root, &order)?;

    Ok(if same_parent { from } else { new_rel })
}

#[tauri::command]
pub fn delete_path(path: String, state: State<VaultState>) -> Result<(), String> {
    let root = get_root(&state)?;
    let full = ensure_inside(&root, Path::new(&path))?;
    let rel = relative_to_root(&root, &full);
    let parent = parent_rel(&rel);
    let name = entry_name(&rel);
    let was_dir = full.is_dir();

    if was_dir {
        fs::remove_dir_all(&full).map_err(|e| format!("Cannot delete folder: {e}"))?;
    } else {
        fs::remove_file(&full).map_err(|e| format!("Cannot delete file: {e}"))?;
    }

    let mut order = read_order(&root);
    order_remove_child(&mut order, &parent, &name);
    if was_dir {
        order_remove_subtree(&mut order, &rel);
    }
    write_order(&root, &order)?;
    Ok(())
}

#[tauri::command]
pub fn resolve_wiki_target(
    target: String,
    state: State<VaultState>,
) -> Result<Option<String>, String> {
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
