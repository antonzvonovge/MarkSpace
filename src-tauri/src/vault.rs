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
/// Vault-relative `.md` path → tags (frontmatter ∪ inline body hashtags).
type TagIndex = HashMap<String, Vec<String>>;

pub struct VaultState {
    pub root: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    /// In-memory tag catalog; rebuilt on vault open, patched on write/rename/delete.
    pub tag_index: Mutex<TagIndex>,
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            root: Mutex::new(None),
            watcher: Mutex::new(None),
            tag_index: Mutex::new(HashMap::new()),
        }
    }
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Reserved vault-root folder for agent skills (visible, protected).
const SKILLS_FOLDER: &str = "Skills";

fn is_skills_folder(rel: &str) -> bool {
    rel == SKILLS_FOLDER
}

fn ensure_skills_folder(root: &Path) -> Result<(), String> {
    let skills = root.join(SKILLS_FOLDER);
    if skills.is_file() {
        return Err("Skills exists as a file; rename it to use agent skills".into());
    }
    if !skills.exists() {
        fs::create_dir_all(&skills).map_err(|e| format!("Cannot create Skills folder: {e}"))?;
        let mut order = read_order(root);
        order_insert_child(&mut order, "", SKILLS_FOLDER, None);
        write_order(root, &order)?;
    }
    Ok(())
}

fn is_markdown(name: &str) -> bool {
    name.ends_with(".md")
}

fn is_drawio(name: &str) -> bool {
    name.ends_with(".drawio")
}

fn is_vault_document(name: &str) -> bool {
    is_markdown(name) || is_drawio(name)
}

const EMPTY_DRAWIO: &str = r#"<mxfile host="MarkSpace" agent="MarkSpace" version="28.2.5" type="device">
  <diagram id="page-1" name="Page-1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
"#;

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

fn collect_drawio_under(root: &Path, dir_rel: &str) -> Result<Vec<String>, String> {
    let dir = if dir_rel.is_empty() {
        root.to_path_buf()
    } else {
        ensure_inside(root, Path::new(dir_rel))?
    };
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
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
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if is_drawio(&name) {
            out.push(relative_to_root(root, path));
        }
    }
    out.sort();
    Ok(out)
}

fn all_markdown_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut notes = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
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
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if is_markdown(&name) {
            notes.push(path.to_path_buf());
        }
    }
    Ok(notes)
}

/// Rewrite `![[old]]` / `![[old|width]]` and `data-drawio-src="old"` across note content.
fn rewrite_drawio_refs_in_content(content: &str, from: &str, to: &str) -> String {
    if from.is_empty() || from == to {
        return content.to_string();
    }

    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(start) = rest.find("![[") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 3..];
        if let Some(end) = after.find("]]") {
            let inner = &after[..end];
            let (target, width) = match inner.split_once('|') {
                Some((t, w)) => (t.trim(), Some(w.trim())),
                None => (inner.trim(), None),
            };
            if target == from {
                out.push_str("![[");
                out.push_str(to);
                if let Some(w) = width {
                    if !w.is_empty() {
                        out.push('|');
                        out.push_str(w);
                    }
                }
                out.push_str("]]");
            } else {
                out.push_str(&rest[start..start + 3 + end + 2]);
            }
            rest = &after[end + 2..];
        } else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        }
    }
    out.push_str(rest);

    let mut next = out.replace(
        &format!("data-drawio-src=\"{from}\""),
        &format!("data-drawio-src=\"{to}\""),
    );

    // Also rewrite ```drawio fence bodies (intermediate / legacy on-disk form).
    next = rewrite_drawio_fences(&next, from, to);
    next
}

fn rewrite_drawio_fences(content: &str, from: &str, to: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    let open = "```drawio";
    while let Some(start) = rest.find(open) {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + open.len()..];
        // Skip optional language trailing spaces / newline
        let body_start = after_open.find('\n').map(|i| i + 1).unwrap_or(0);
        let body = &after_open[body_start..];
        if let Some(end) = body.find("```") {
            let fence_body = &body[..end];
            let rewritten = fence_body.lines()
                .map(|line| {
                    let trimmed = line.trim();
                    if trimmed == from || trimmed.starts_with(&format!("{from}|")) {
                        format!("{}{}", to, &trimmed[from.len()..])
                    } else {
                        line.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            out.push_str(open);
            out.push_str(&after_open[..body_start]);
            out.push_str(&rewritten);
            out.push_str("```");
            rest = &body[end + 3..];
        } else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    out
}

fn rewrite_drawio_embeds_vault(root: &Path, from: &str, to: &str) -> Result<(), String> {
    if from.is_empty() || from == to {
        return Ok(());
    }
    for note in all_markdown_files(root)? {
        let Ok(content) = fs::read_to_string(&note) else {
            continue;
        };
        if !content.contains(from) {
            continue;
        }
        let next = rewrite_drawio_refs_in_content(&content, from, to);
        if next != content {
            fs::write(&note, next).map_err(|e| format!("Cannot rewrite drawio embeds: {e}"))?;
        }
    }
    Ok(())
}

fn rewrite_drawio_after_path_change(
    root: &Path,
    from_rel: &str,
    to_rel: &str,
    was_dir: bool,
    was_drawio_file: bool,
) -> Result<(), String> {
    if was_drawio_file {
        return rewrite_drawio_embeds_vault(root, from_rel, to_rel);
    }
    if !was_dir {
        return Ok(());
    }
    let drawios = collect_drawio_under(root, to_rel)?;
    for new_path in drawios {
        let suffix = if new_path == to_rel {
            String::new()
        } else if let Some(rest) = new_path.strip_prefix(&format!("{to_rel}/")) {
            rest.to_string()
        } else {
            continue;
        };
        let old_path = if suffix.is_empty() {
            from_rel.to_string()
        } else {
            format!("{from_rel}/{suffix}")
        };
        rewrite_drawio_embeds_vault(root, &old_path, &new_path)?;
    }
    Ok(())
}

fn ensure_document_extension(from_full: &Path, to_rel: &str) -> String {
    let mut to_rel = to_rel.trim().trim_start_matches('/').to_string();
    if !from_full.is_file() {
        return to_rel;
    }
    let from_name = from_full
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if is_drawio(&from_name) {
        if !to_rel.ends_with(".drawio") {
            if to_rel.ends_with(".md") {
                to_rel.truncate(to_rel.len() - 3);
            }
            to_rel.push_str(".drawio");
        }
        return to_rel;
    }
    if is_markdown(&from_name) && !to_rel.ends_with(".md") && !to_rel.ends_with(".drawio") {
        to_rel.push_str(".md");
    }
    to_rel
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
        } else if is_vault_document(&name) {
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
        if path.is_dir() || is_vault_document(&name) {
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

    ensure_skills_folder(&root)?;

    {
        let mut guard = state.root.lock().map_err(|_| "Vault state lock poisoned")?;
        *guard = Some(root.clone());
    }

    replace_tag_index(&state, rebuild_tag_index(&root));
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
    fs::write(&full, &content).map_err(|e| format!("Cannot write note: {e}"))?;
    let rel = relative_to_root(&root, &full);
    if is_markdown(&rel) {
        set_tag_index_path(&state, &rel, tags_from_note_content(&content));
    }
    Ok(())
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
    fs::write(&full, &content).map_err(|e| format!("Cannot create note: {e}"))?;

    let created = relative_to_root(&root, &full);
    set_tag_index_path(&state, &created, Vec::new());
    let parent = parent_rel(&created);
    let name = entry_name(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(created)
}

#[tauri::command]
pub fn create_drawio(path: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let mut rel = path.trim().trim_start_matches('/').to_string();
    if !rel.ends_with(".drawio") {
        if rel.ends_with(".md") {
            rel.truncate(rel.len() - 3);
        }
        rel.push_str(".drawio");
    }
    let full = ensure_inside(&root, Path::new(&rel))?;
    if full.exists() {
        return Err("Diagram already exists".into());
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;
    }
    fs::write(&full, EMPTY_DRAWIO).map_err(|e| format!("Cannot create diagram: {e}"))?;

    let created = relative_to_root(&root, &full);
    let parent = parent_rel(&created);
    let name = entry_name(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(created)
}

/// Resolve a .drawio path for embedding next to a note.
/// If `source` is already inside the vault, returns its vault-relative path.
/// Otherwise copies the file into the note's folder and returns the new relative path.
#[tauri::command]
pub fn import_drawio(
    note_path: String,
    source: String,
    state: State<VaultState>,
) -> Result<String, String> {
    let root = get_root(&state)?;
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve vault root: {e}"))?;

    let note_rel = note_path.trim().trim_start_matches('/').to_string();
    if note_rel.is_empty() {
        return Err("Note path required".into());
    }
    let _note_full = ensure_inside(&root, Path::new(&note_rel))?;

    let source_path = PathBuf::from(source.trim());
    if !source_path.is_file() {
        return Err("Selected file not found".into());
    }
    let source_canon = source_path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve selected file: {e}"))?;

    let source_name = source_canon
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "diagram.drawio".into());
    if !is_drawio(&source_name) {
        return Err("Selected file must be a .drawio diagram".into());
    }

    if source_canon.starts_with(&root_canon) {
        return Ok(relative_to_root(&root_canon, &source_canon));
    }

    let dest_parent_rel = parent_rel(&note_rel);
    let dest_dir = if dest_parent_rel.is_empty() {
        root_canon.clone()
    } else {
        ensure_inside(&root, Path::new(&dest_parent_rel))?
    };
    fs::create_dir_all(&dest_dir).map_err(|e| format!("Cannot create folders: {e}"))?;

    let unique = unique_filename(&dest_dir, &source_name);
    let dest = dest_dir.join(&unique);
    fs::copy(&source_canon, &dest).map_err(|e| format!("Cannot copy diagram into vault: {e}"))?;

    let created = relative_to_root(&root_canon, &dest);
    let parent = parent_rel(&created);
    let name = entry_name(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(created)
}

/// Copy external files/folders (from OS clipboard / explorer) into a vault folder.
/// Only `.md` / `.drawio` files are imported; directory structure is preserved.
#[tauri::command]
pub fn import_paths(
    parent: String,
    sources: Vec<String>,
    state: State<VaultState>,
) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve vault root: {e}"))?;
    let parent_rel = parent.trim().trim_start_matches('/').to_string();
    let dest_dir = if parent_rel.is_empty() {
        root_canon.clone()
    } else {
        let full = ensure_inside(&root, Path::new(&parent_rel))?;
        if !full.is_dir() {
            return Err("Destination folder not found".into());
        }
        full
    };

    let mut order = read_order(&root);
    let mut created = Vec::new();
    for source in sources {
        let source_path = PathBuf::from(source.trim());
        if source.trim().is_empty() {
            continue;
        }
        import_path_recursive(
            &root,
            &root_canon,
            &dest_dir,
            &parent_rel,
            &source_path,
            &mut order,
            &mut created,
        )?;
    }
    write_order(&root, &order)?;
    for rel in &created {
        if is_markdown(rel) {
            let full = root.join(rel);
            if let Ok(text) = fs::read_to_string(&full) {
                set_tag_index_path(&state, rel, tags_from_note_content(&text));
            }
        }
    }
    Ok(created)
}

fn import_path_recursive(
    root: &Path,
    root_canon: &Path,
    dest_dir: &Path,
    dest_parent_rel: &str,
    source: &Path,
    order: &mut OrderMap,
    created: &mut Vec<String>,
) -> Result<(), String> {
    if !source.exists() {
        return Err(format!("Path not found: {}", source.display()));
    }
    let source_canon = source
        .canonicalize()
        .map_err(|e| format!("Cannot resolve {}: {e}", source.display()))?;

    // Skip anything already inside the vault (avoid duplicates / self-copy).
    if source_canon.starts_with(root_canon) {
        return Ok(());
    }

    let name = source_canon
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() || is_hidden(&name) {
        return Ok(());
    }

    if source_canon.is_file() {
        if !is_vault_document(&name) {
            return Ok(());
        }
        fs::create_dir_all(dest_dir).map_err(|e| format!("Cannot create folders: {e}"))?;
        let unique = unique_filename(dest_dir, &name);
        let dest = dest_dir.join(&unique);
        fs::copy(&source_canon, &dest)
            .map_err(|e| format!("Cannot copy {}: {e}", source.display()))?;
        let rel = relative_to_root(root_canon, &dest);
        order_insert_child(order, dest_parent_rel, &unique, None);
        created.push(rel);
        return Ok(());
    }

    if source_canon.is_dir() {
        let unique_dir = unique_filename(dest_dir, &name);
        let next_dir = dest_dir.join(&unique_dir);
        fs::create_dir_all(&next_dir).map_err(|e| format!("Cannot create folder: {e}"))?;
        let next_rel = join_parent(dest_parent_rel, &unique_dir);
        order_insert_child(order, dest_parent_rel, &unique_dir, None);
        created.push(next_rel.clone());

        let entries = fs::read_dir(&source_canon)
            .map_err(|e| format!("Cannot read folder {}: {e}", source.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Cannot read folder entry: {e}"))?;
            import_path_recursive(
                root,
                root_canon,
                &next_dir,
                &next_rel,
                &entry.path(),
                order,
                created,
            )?;
        }
    }

    Ok(())
}

/// Write a vault document from clipboard/file bytes into a folder.
#[tauri::command]
pub fn import_document_bytes(
    parent: String,
    file_name: String,
    data_base64: String,
    state: State<VaultState>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let root = get_root(&state)?;
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve vault root: {e}"))?;
    let parent_rel = parent.trim().trim_start_matches('/').to_string();
    let name = sanitize_asset_filename(&file_name);
    if !is_vault_document(&name) {
        return Err("Only .md and .drawio files can be imported".into());
    }

    let data = STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("Invalid file data: {e}"))?;

    let dest_dir = if parent_rel.is_empty() {
        root_canon.clone()
    } else {
        let full = ensure_inside(&root, Path::new(&parent_rel))?;
        if !full.is_dir() {
            return Err("Destination folder not found".into());
        }
        full
    };
    fs::create_dir_all(&dest_dir).map_err(|e| format!("Cannot create folders: {e}"))?;

    let unique = unique_filename(&dest_dir, &name);
    let dest = dest_dir.join(&unique);
    fs::write(&dest, data).map_err(|e| format!("Cannot write file: {e}"))?;

    let created = relative_to_root(&root_canon, &dest);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent_rel, &unique, None);
    write_order(&root, &order)?;
    if is_markdown(&created) {
        if let Ok(text) = fs::read_to_string(&dest) {
            set_tag_index_path(&state, &created, tags_from_note_content(&text));
        }
    }
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
    let from_rel_check = relative_to_root(&root, &from_full);
    if is_skills_folder(&from_rel_check) {
        return Err("Cannot rename the Skills folder".into());
    }
    let to_rel = ensure_document_extension(&from_full, &to);
    if is_skills_folder(&to_rel) {
        return Err("Cannot rename to the reserved Skills folder".into());
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
    let was_drawio = !was_dir && is_drawio(&from_name);

    fs::rename(&from_full, &to_full).map_err(|e| format!("Cannot rename: {e}"))?;
    let to_rel = relative_to_root(&root, &to_full);
    let to_parent = parent_rel(&to_rel);
    let to_name = entry_name(&to_rel);

    maybe_migrate_moved_note(&root, &from_rel, &to_rel, !was_dir)?;
    rewrite_drawio_after_path_change(&root, &from_rel, &to_rel, was_dir, was_drawio)?;

    let mut order = read_order(&root);
    if from_parent == to_parent {
        // Keep sort position: replace basename in-place instead of remove+append.
        let mut replaced = false;
        if let Some(list) = order.get_mut(&from_parent) {
            if let Some(pos) = list.iter().position(|n| n == &from_name) {
                list[pos] = to_name.clone();
                replaced = true;
            }
        }
        if !replaced {
            materialize_parent_order(&root, &mut order, &to_parent)?;
        }
    } else {
        order_remove_child(&mut order, &from_parent, &from_name);
        materialize_parent_order(&root, &mut order, &to_parent)?;
        order_insert_child(&mut order, &to_parent, &to_name, None);
    }
    if was_dir {
        rewrite_order_keys_after_move(&mut order, &from_rel, &to_rel);
    }
    write_order(&root, &order)?;
    let _ = crate::favorites::remap_favorites(&root, &from_rel, Some(&to_rel));
    let _ = crate::projects::remap_project_properties(&root, &from_rel, Some(&to_rel));
    remap_tag_index_path(&state, &from_rel, Some(&to_rel));

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
    // Skills may be reordered among vault-root siblings, but not nested elsewhere.
    if is_skills_folder(&from) && from_parent != to_parent {
        return Err("Cannot move the Skills folder into another folder".into());
    }
    let was_dir = from_full.is_dir();
    let was_drawio = !was_dir && is_drawio(&name);
    let new_rel = join_parent(&to_parent, &name);
    // Block promoting some other entry into the reserved Skills path.
    if is_skills_folder(&new_rel) && from != SKILLS_FOLDER {
        return Err("Cannot move into the reserved Skills folder name".into());
    }
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
        rewrite_drawio_after_path_change(&root, &from, &new_rel, was_dir, was_drawio)?;
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
    if !same_parent {
        let _ = crate::favorites::remap_favorites(&root, &from, Some(&new_rel));
        let _ = crate::projects::remap_project_properties(&root, &from, Some(&new_rel));
        remap_tag_index_path(&state, &from, Some(&new_rel));
    }

    Ok(if same_parent { from } else { new_rel })
}

#[tauri::command]
pub fn delete_path(path: String, state: State<VaultState>) -> Result<(), String> {
    let root = get_root(&state)?;
    let full = ensure_inside(&root, Path::new(&path))?;
    let rel = relative_to_root(&root, &full);
    if is_skills_folder(&rel) {
        return Err("Cannot delete the Skills folder".into());
    }
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
    let _ = crate::favorites::remap_favorites(&root, &rel, None);
    let _ = crate::projects::remap_project_properties(&root, &rel, None);
    remove_tag_index_path(&state, &rel);
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub snippet: String,
}

#[tauri::command]
pub fn search_notes(
    query: String,
    state: State<VaultState>,
) -> Result<Vec<SearchHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let q_lower = q.to_lowercase();
    let root = get_root(&state)?;
    let mut hits: Vec<SearchHit> = Vec::new();
    const MAX_FILES: usize = 40;
    const MAX_HITS_PER_FILE: usize = 5;
    const MAX_TOTAL: usize = 80;

    let mut files_searched = 0usize;
    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            e.file_name()
                .to_str()
                .map(|n| !is_hidden(n))
                .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
    {
        if hits.len() >= MAX_TOTAL || files_searched >= MAX_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !is_markdown(&name) {
            continue;
        }
        files_searched += 1;
        let full = entry.path();
        let rel = relative_to_root(&root, full);
        let Ok(content) = fs::read_to_string(full) else {
            continue;
        };
        let mut file_hits = 0usize;
        for (idx, line) in content.lines().enumerate() {
            if file_hits >= MAX_HITS_PER_FILE || hits.len() >= MAX_TOTAL {
                break;
            }
            if line.to_lowercase().contains(&q_lower) {
                let snippet = line.trim();
                let snippet = if snippet.chars().count() > 200 {
                    let truncated: String = snippet.chars().take(200).collect();
                    format!("{truncated}…")
                } else {
                    snippet.to_string()
                };
                hits.push(SearchHit {
                    path: rel.clone(),
                    line: idx + 1,
                    snippet,
                });
                file_hits += 1;
            }
        }
    }

    Ok(hits)
}

/// Extract YAML frontmatter body between leading `---` fences, if present.
fn frontmatter_yaml(content: &str) -> Option<&str> {
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let after_open = if text.starts_with("---\r\n") {
        5
    } else if text.starts_with("---\n") {
        4
    } else {
        return None;
    };
    let rest = &text[after_open..];
    let close = if rest.starts_with("---") {
        0
    } else {
        rest.find("\n---")?
    };
    let yaml = &rest[..close];
    Some(yaml.strip_suffix('\r').unwrap_or(yaml))
}

fn normalize_tag_name(raw: &str) -> Option<String> {
    let mut t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(rest) = t.strip_prefix('#') {
        t = rest.trim();
    }
    if t.is_empty() {
        return None;
    }
    Some(t.to_string())
}

/// Pull tag strings from a frontmatter YAML snippet (common Obsidian forms).
fn tags_from_frontmatter_yaml(yaml: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let mut in_tags_list = false;

    for raw_line in yaml.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            if in_tags_list && !line.starts_with(' ') && !line.starts_with('\t') {
                in_tags_list = false;
            }
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("tags:") {
            in_tags_list = false;
            let value = rest.trim();
            if value.is_empty() {
                in_tags_list = true;
                continue;
            }
            if let Some(inner) = value
                .strip_prefix('[')
                .and_then(|s| s.strip_suffix(']'))
            {
                for part in inner.split(',') {
                    let part = part.trim().trim_matches('"').trim_matches('\'');
                    if let Some(name) = normalize_tag_name(part) {
                        tags.push(name);
                    }
                }
                continue;
            }
            // Scalar or comma-separated.
            if value.contains(',') {
                for part in value.split(',') {
                    let part = part.trim().trim_matches('"').trim_matches('\'');
                    if let Some(name) = normalize_tag_name(part) {
                        tags.push(name);
                    }
                }
            } else {
                let part = value.trim_matches('"').trim_matches('\'');
                if let Some(name) = normalize_tag_name(part) {
                    tags.push(name);
                }
            }
            continue;
        }

        if in_tags_list {
            let is_indent = line.starts_with(' ') || line.starts_with('\t');
            if !is_indent {
                in_tags_list = false;
            } else if let Some(item) = trimmed.strip_prefix("- ") {
                let part = item.trim().trim_matches('"').trim_matches('\'');
                if let Some(name) = normalize_tag_name(part) {
                    tags.push(name);
                }
            } else if trimmed == "-" {
                continue;
            } else {
                in_tags_list = false;
            }
        }
    }

    tags
}

fn body_after_frontmatter(content: &str) -> &str {
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let after_open = if text.starts_with("---\r\n") {
        5
    } else if text.starts_with("---\n") {
        4
    } else {
        return text;
    };
    let rest = &text[after_open..];
    if rest.starts_with("---") {
        let after = if rest.starts_with("---\r\n") {
            5
        } else if rest.starts_with("---\n") {
            4
        } else if rest == "---" {
            3
        } else {
            return text;
        };
        return &rest[after..];
    }
    if let Some(idx) = rest.find("\n---") {
        let after_close = idx + 1 + 3; // \n + ---
        let tail = &rest[after_close..];
        if let Some(stripped) = tail.strip_prefix("\r\n") {
            return stripped;
        }
        if let Some(stripped) = tail.strip_prefix('\n') {
            return stripped;
        }
        if tail.is_empty() || tail.starts_with('\r') || tail.starts_with(' ') || tail.starts_with('\t')
        {
            // `---\n` or `---\r` or trailing spaces before EOL already handled; tolerate EOF.
            return tail.trim_start_matches(['\r', '\n', ' ', '\t']);
        }
    }
    text
}

fn is_tag_name_start(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn is_tag_name_cont(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

fn is_hashtag_boundary(prev: Option<char>) -> bool {
    match prev {
        None => true,
        Some(c) => !(c.is_alphanumeric() || c == '_' || c == '-' || c == '/'),
    }
}

/// Collect inline `#tags` from note body, skipping fenced/inline code.
fn tags_from_body_hashtags(body: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let chars: Vec<char> = body.chars().collect();
    let n = chars.len();
    let mut i = 0usize;
    let mut prev: Option<char> = None;
    let mut in_fence: Option<char> = None; // '`' or '~'
    let mut fence_len = 0usize;

    while i < n {
        let c = chars[i];

        // Fenced code open/close at line start.
        if (c == '`' || c == '~') && (prev.is_none() || prev == Some('\n')) {
            let mut run = 1usize;
            while i + run < n && chars[i + run] == c {
                run += 1;
            }
            if run >= 3 {
                if let Some(fc) = in_fence {
                    if fc == c && run >= fence_len {
                        in_fence = None;
                        fence_len = 0;
                    }
                } else {
                    in_fence = Some(c);
                    fence_len = run;
                }
                // Skip fence marker + rest of line
                i += run;
                while i < n && chars[i] != '\n' {
                    i += 1;
                }
                prev = chars.get(i).copied();
                if i < n {
                    i += 1; // consume newline
                    prev = Some('\n');
                }
                continue;
            }
        }

        if in_fence.is_some() {
            prev = Some(c);
            i += 1;
            continue;
        }

        // Inline code `...`
        if c == '`' {
            let mut run = 1usize;
            while i + run < n && chars[i + run] == '`' {
                run += 1;
            }
            i += run;
            let mut j = i;
            let mut matched = false;
            while j + run <= n {
                if chars[j..j + run].iter().all(|ch| *ch == '`') {
                    i = j + run;
                    prev = Some('`');
                    matched = true;
                    break;
                }
                j += 1;
            }
            if matched {
                continue;
            }
            prev = Some('`');
            continue;
        }

        // Hashtag
        if c == '#' && is_hashtag_boundary(prev) {
            let start = i + 1;
            if start < n && is_tag_name_start(chars[start]) {
                let mut end = start + 1;
                while end < n && is_tag_name_cont(chars[end]) {
                    end += 1;
                }
                let name: String = chars[start..end].iter().collect();
                if let Some(normalized) = normalize_tag_name(&name) {
                    tags.push(normalized);
                }
                i = end;
                prev = chars.get(end.wrapping_sub(1)).copied();
                continue;
            }
        }

        prev = Some(c);
        i += 1;
    }

    tags
}

fn tags_from_note_content(content: &str) -> Vec<String> {
    // Dedupe within a note (case-insensitive): frontmatter ∪ body hashtags.
    let mut seen: HashMap<String, String> = HashMap::new();
    if let Some(yaml) = frontmatter_yaml(content) {
        for tag in tags_from_frontmatter_yaml(yaml) {
            let key = tag.to_lowercase();
            seen.entry(key).or_insert(tag);
        }
    }
    let body = body_after_frontmatter(content);
    for tag in tags_from_body_hashtags(body) {
        let key = tag.to_lowercase();
        seen.entry(key).or_insert(tag);
    }
    seen.into_values().collect()
}

fn unique_sorted_tags(index: &TagIndex) -> Vec<String> {
    let mut seen: HashMap<String, String> = HashMap::new();
    for tags in index.values() {
        for tag in tags {
            let key = tag.to_lowercase();
            seen.entry(key).or_insert_with(|| tag.clone());
        }
    }
    let mut out: Vec<String> = seen.into_values().collect();
    out.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    out
}

fn rebuild_tag_index(root: &Path) -> TagIndex {
    let mut index = TagIndex::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            e.file_name()
                .to_str()
                .map(|n| !is_hidden(n))
                .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !is_markdown(&name) {
            continue;
        }
        let Ok(text) = fs::read_to_string(entry.path()) else {
            continue;
        };
        let tags = tags_from_note_content(&text);
        if tags.is_empty() {
            continue;
        }
        let rel = relative_to_root(root, entry.path());
        index.insert(rel, tags);
    }
    index
}

fn set_tag_index_path(state: &VaultState, rel: &str, tags: Vec<String>) {
    let Ok(mut guard) = state.tag_index.lock() else {
        return;
    };
    if tags.is_empty() {
        guard.remove(rel);
    } else {
        guard.insert(rel.to_string(), tags);
    }
}

fn remove_tag_index_path(state: &VaultState, rel: &str) {
    let Ok(mut guard) = state.tag_index.lock() else {
        return;
    };
    guard.remove(rel);
    let prefix = format!("{rel}/");
    guard.retain(|path, _| !path.starts_with(&prefix));
}

fn remap_tag_index_path(state: &VaultState, from: &str, to: Option<&str>) {
    let Ok(mut guard) = state.tag_index.lock() else {
        return;
    };
    let mut next = TagIndex::new();
    for (path, tags) in guard.drain() {
        if path == from {
            if let Some(to) = to {
                next.insert(to.to_string(), tags);
            }
            continue;
        }
        if let Some(rest) = path.strip_prefix(&format!("{from}/")) {
            if let Some(to) = to {
                next.insert(format!("{to}/{rest}"), tags);
            }
            continue;
        }
        next.insert(path, tags);
    }
    *guard = next;
}

fn replace_tag_index(state: &VaultState, index: TagIndex) {
    if let Ok(mut guard) = state.tag_index.lock() {
        *guard = index;
    }
}

#[tauri::command]
pub fn list_vault_tags(state: State<VaultState>) -> Result<Vec<String>, String> {
    let guard = state
        .tag_index
        .lock()
        .map_err(|_| "Tag index lock poisoned")?;
    Ok(unique_sorted_tags(&guard))
}

/// Re-read one note's head into the tag index (external edits / watcher).
#[tauri::command]
pub fn reindex_note_tags(path: String, state: State<VaultState>) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    let rel = path.trim().trim_start_matches('/').to_string();
    if !rel.to_lowercase().ends_with(".md") {
        let guard = state
            .tag_index
            .lock()
            .map_err(|_| "Tag index lock poisoned")?;
        return Ok(unique_sorted_tags(&guard));
    }
    let full = ensure_inside(&root, Path::new(&rel))?;
    if !full.is_file() {
        remove_tag_index_path(&state, &rel);
    } else {
        let text = fs::read_to_string(&full).map_err(|e| format!("Cannot read note: {e}"))?;
        let tags = tags_from_note_content(&text);
        set_tag_index_path(&state, &rel, tags);
    }
    let guard = state
        .tag_index
        .lock()
        .map_err(|_| "Tag index lock poisoned")?;
    Ok(unique_sorted_tags(&guard))
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

const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBytesResponse {
    pub path: String,
    pub data_base64: String,
    pub byte_length: usize,
}

/// Read any vault file as base64 (images, pdfs, etc.).
#[tauri::command]
pub fn read_file_bytes(path: String, state: State<VaultState>) -> Result<FileBytesResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let root = get_root(&state)?;
    let rel = path.trim().trim_start_matches('/').to_string();
    if rel.is_empty() {
        return Err("Path required".into());
    }
    let full = ensure_inside(&root, Path::new(&rel))?;
    if !full.is_file() {
        return Err("File not found".into());
    }
    let data = fs::read(&full).map_err(|e| format!("Cannot read file: {e}"))?;
    if data.len() > MAX_FILE_BYTES {
        return Err(format!(
            "File too large ({} bytes, max {MAX_FILE_BYTES})",
            data.len()
        ));
    }
    let path_out = relative_to_root(&root, &full);
    Ok(FileBytesResponse {
        path: path_out,
        byte_length: data.len(),
        data_base64: STANDARD.encode(&data),
    })
}

/// Write raw bytes to a vault-relative path (creates parent folders).
/// If the file already exists, picks a unique sibling name.
#[tauri::command]
pub fn write_file_bytes(
    path: String,
    data_base64: String,
    state: State<VaultState>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let root = get_root(&state)?;
    let rel = path.trim().trim_start_matches('/').to_string();
    if rel.is_empty() {
        return Err("Path required".into());
    }
    if rel.ends_with('/') {
        return Err("Path must include a filename".into());
    }
    let data = STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("Invalid file data: {e}"))?;
    if data.is_empty() {
        return Err("Empty file data".into());
    }
    if data.len() > MAX_FILE_BYTES {
        return Err(format!(
            "File too large ({} bytes, max {MAX_FILE_BYTES})",
            data.len()
        ));
    }

    let full = ensure_inside(&root, Path::new(&rel))?;
    let parent = full
        .parent()
        .ok_or_else(|| "Invalid destination path".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;

    let desired = full
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file.bin".into());
    let unique = unique_filename(parent, &desired);
    let dest = parent.join(&unique);
    fs::write(&dest, &data).map_err(|e| format!("Cannot write file: {e}"))?;

    let created = relative_to_root(&root, &dest);
    let parent_rel_s = parent_rel(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent_rel_s, &unique, None);
    write_order(&root, &order)?;
    Ok(created)
}
