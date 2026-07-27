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

fn assets_dir_rel(note_parent: &str) -> String {
    join_parent(note_parent, ".assets")
}

fn sanitize_asset_filename(name: &str) -> String {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .trim();
    if base.is_empty() || base == "." || base == ".." {
        return "image.png".into();
    }
    base.to_string()
}

fn unique_filename(dir: &Path, desired: &str) -> String {
    let desired = sanitize_asset_filename(desired);
    if !dir.join(&desired).exists() {
        return desired;
    }
    let path = Path::new(&desired);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".into());
    let ext = path.extension().and_then(|s| s.to_str());
    for i in 1..10_000 {
        let candidate = match ext {
            Some(e) => format!("{stem}-{i}.{e}"),
            None => format!("{stem}-{i}"),
        };
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    match ext {
        Some(e) => format!(
            "{stem}-{}.{e}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ),
        None => format!(
            "{stem}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ),
    }
}

fn extract_asset_refs(content: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let needle = ".assets/";
    let mut search_from = 0;
    while let Some(idx) = content[search_from..].find(needle) {
        let start = search_from + idx;
        let after = &content[start + needle.len()..];
        let end_rel = after
            .find(|c: char| {
                matches!(
                    c,
                    ')' | '"' | '\'' | '>' | ' ' | ']' | '\n' | '\r' | '?' | '#' | '\\'
                )
            })
            .unwrap_or(after.len());
        let filename = &after[..end_rel];
        if !filename.is_empty()
            && !filename.contains("..")
            && !filename.contains('/')
            && !filename.contains('\\')
        {
            refs.push(format!(".assets/{filename}"));
        }
        search_from = start + needle.len() + end_rel.max(1);
    }
    refs.sort();
    refs.dedup();
    refs
}

fn try_remove_empty_dir(path: &Path) {
    if path.is_dir() {
        let _ = fs::remove_dir(path);
    }
}

fn sibling_notes(root: &Path, parent_rel: &str) -> Result<Vec<PathBuf>, String> {
    let dir = if parent_rel.is_empty() {
        root.to_path_buf()
    } else {
        ensure_inside(root, Path::new(parent_rel))?
    };
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut notes = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("Cannot read directory: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Cannot read entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if is_hidden(&name) {
            continue;
        }
        let path = entry.path();
        if path.is_file() && name.ends_with(".md") {
            notes.push(path);
        }
    }
    Ok(notes)
}

fn asset_referenced_by_other_notes(
    root: &Path,
    parent_rel: &str,
    exclude_note_rel: &str,
    asset_url: &str,
) -> Result<bool, String> {
    let exclude = ensure_inside(root, Path::new(exclude_note_rel)).ok();
    for note in sibling_notes(root, parent_rel)? {
        if exclude.as_ref().is_some_and(|ex| ex == &note) {
            continue;
        }
        let Ok(content) = fs::read_to_string(&note) else {
            continue;
        };
        if content.contains(asset_url) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn migrate_note_assets(
    root: &Path,
    from_note_rel: &str,
    to_note_rel: &str,
    content: &str,
) -> Result<String, String> {
    let from_parent = parent_rel(from_note_rel);
    let to_parent = parent_rel(to_note_rel);
    if from_parent == to_parent {
        return Ok(content.to_string());
    }

    let refs = extract_asset_refs(content);
    if refs.is_empty() {
        return Ok(content.to_string());
    }

    let from_assets_rel = assets_dir_rel(&from_parent);
    let to_assets_rel = assets_dir_rel(&to_parent);
    let from_assets = ensure_inside(root, Path::new(&from_assets_rel))?;
    let to_assets = ensure_inside(root, Path::new(&to_assets_rel))?;
    fs::create_dir_all(&to_assets).map_err(|e| format!("Cannot create .assets: {e}"))?;

    let mut new_content = content.to_string();
    let mut replacements: Vec<(String, String)> = Vec::new();

    for rel_url in refs {
        let filename = rel_url.trim_start_matches(".assets/");
        let src = from_assets.join(filename);
        if !src.is_file() {
            continue;
        }

        let still_needed =
            asset_referenced_by_other_notes(root, &from_parent, from_note_rel, &rel_url)?;
        let unique = unique_filename(&to_assets, filename);
        let dest = to_assets.join(&unique);
        let new_url = format!(".assets/{unique}");

        if still_needed {
            fs::copy(&src, &dest).map_err(|e| format!("Cannot copy asset: {e}"))?;
        } else if let Err(e) = fs::rename(&src, &dest) {
            fs::copy(&src, &dest).map_err(|copy_e| {
                format!("Cannot move asset ({e}); copy also failed: {copy_e}")
            })?;
            let _ = fs::remove_file(&src);
        }

        if rel_url != new_url {
            replacements.push((rel_url, new_url));
        }
    }

    replacements.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    for (old, new) in replacements {
        new_content = new_content.replace(&old, &new);
    }

    try_remove_empty_dir(&from_assets);
    Ok(new_content)
}

fn cleanup_note_assets(root: &Path, note_rel: &str, content: &str) -> Result<(), String> {
    let parent = parent_rel(note_rel);
    let assets_rel = assets_dir_rel(&parent);
    let assets = ensure_inside(root, Path::new(&assets_rel))?;
    if !assets.is_dir() {
        return Ok(());
    }

    for rel_url in extract_asset_refs(content) {
        if asset_referenced_by_other_notes(root, &parent, note_rel, &rel_url)? {
            continue;
        }
        let filename = rel_url.trim_start_matches(".assets/");
        let path = assets.join(filename);
        if path.is_file() {
            let _ = fs::remove_file(path);
        }
    }
    try_remove_empty_dir(&assets);
    Ok(())
}

fn maybe_migrate_moved_note(
    root: &Path,
    from_rel: &str,
    to_rel: &str,
    was_file: bool,
) -> Result<(), String> {
    if !was_file || !to_rel.ends_with(".md") {
        return Ok(());
    }
    if parent_rel(from_rel) == parent_rel(to_rel) {
        return Ok(());
    }
    let to_full = ensure_inside(root, Path::new(to_rel))?;
    let content =
        fs::read_to_string(&to_full).map_err(|e| format!("Cannot read note after move: {e}"))?;
    let new_content = migrate_note_assets(root, from_rel, to_rel, &content)?;
    if new_content != content {
        fs::write(&to_full, new_content).map_err(|e| format!("Cannot update note assets: {e}"))?;
    }
    Ok(())
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

/// Normalize EOLs to LF so BlockNote's markdown parser can detect fenced code.
fn normalize_newlines(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

#[tauri::command]
pub fn read_note(path: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let full = ensure_inside(&root, Path::new(&path))?;
    if !full.is_file() {
        return Err("Note not found".into());
    }
    let raw = fs::read_to_string(&full).map_err(|e| format!("Cannot read note: {e}"))?;
    Ok(normalize_newlines(&raw))
}

#[tauri::command]
pub fn write_note(path: String, content: String, state: State<VaultState>) -> Result<(), String> {
    let root = get_root(&state)?;
    let full = ensure_inside(&root, Path::new(&path))?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;
    }
    let content = normalize_newlines(&content);
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

    maybe_migrate_moved_note(&root, &from_rel, &to_rel, !was_dir)?;

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
        maybe_migrate_moved_note(&root, &from, &new_rel, !was_dir)?;
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

    if !was_dir && rel.ends_with(".md") {
        if let Ok(content) = fs::read_to_string(&full) {
            cleanup_note_assets(&root, &rel, &content)?;
        }
    }

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

#[tauri::command]
pub fn absolute_path(path: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let full = ensure_inside(&root, Path::new(&path))?;
    Ok(full.to_string_lossy().to_string())
}

#[tauri::command]
pub fn write_asset(
    note_path: String,
    file_name: String,
    data_base64: String,
    state: State<VaultState>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let root = get_root(&state)?;
    let note_rel = note_path.trim().trim_start_matches('/').to_string();
    if note_rel.is_empty() {
        return Err("Note path required".into());
    }
    let note_full = ensure_inside(&root, Path::new(&note_rel))?;
    if !note_full.is_file() {
        return Err("Note not found".into());
    }

    let data = STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("Invalid asset data: {e}"))?;
    if data.is_empty() {
        return Err("Empty asset data".into());
    }

    let parent = parent_rel(&note_rel);
    let assets_rel = assets_dir_rel(&parent);
    let assets = ensure_inside(&root, Path::new(&assets_rel))?;
    fs::create_dir_all(&assets).map_err(|e| format!("Cannot create .assets: {e}"))?;

    let unique = unique_filename(&assets, &file_name);
    let dest = assets.join(&unique);
    fs::write(&dest, data).map_err(|e| format!("Cannot write asset: {e}"))?;
    Ok(format!(".assets/{unique}"))
}
