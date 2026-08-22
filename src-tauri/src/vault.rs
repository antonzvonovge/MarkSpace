use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
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

/// Hidden overview note inside a folder (omitted from the sidebar tree).
pub(crate) const FOLDER_NOTE_NAME: &str = ".folder.md";

fn is_folder_note_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(FOLDER_NOTE_NAME)
}

/// Vault-relative path of the folder note for `folder_rel` (must be non-empty).
fn folder_note_rel(folder_rel: &str) -> String {
    format!("{folder_rel}/{FOLDER_NOTE_NAME}")
}

/// WalkDir: skip hidden dirs/files, but still visit `.folder.md`.
fn walk_entry_allowed(name: &str) -> bool {
    is_folder_note_name(name) || !is_hidden(name)
}

/// True when a path component is a hidden name other than the folder note file.
fn is_skipped_hidden_component(name: &str) -> bool {
    name.starts_with('.') && !is_folder_note_name(name)
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

fn is_mdlnks(name: &str) -> bool {
    name.ends_with(".mdlnks")
}

fn is_mddict(name: &str) -> bool {
    name.ends_with(".mddict")
}

fn is_mdhabit(name: &str) -> bool {
    name.ends_with(".mdhabit")
}

fn is_pdf(name: &str) -> bool {
    name.ends_with(".pdf")
}

fn is_vault_document(name: &str) -> bool {
    is_markdown(name)
        || is_drawio(name)
        || is_mdlnks(name)
        || is_mddict(name)
        || is_mdhabit(name)
        || is_pdf(name)
}

const EMPTY_MDLNKS: &str = "# MarkSpace links v1\n";
const EMPTY_MDDICT: &str = "# MarkSpace dictionary v1\n";

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

pub(crate) fn ensure_inside(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
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

fn strip_known_doc_ext(rel: &mut String) {
    if rel.ends_with(".md") {
        rel.truncate(rel.len() - 3);
    } else if rel.ends_with(".drawio") {
        rel.truncate(rel.len() - 7);
    } else if rel.ends_with(".mdlnks") {
        rel.truncate(rel.len() - 7);
    } else if rel.ends_with(".mddict") {
        rel.truncate(rel.len() - 7);
    } else if rel.ends_with(".mdhabit") {
        rel.truncate(rel.len() - 8);
    } else if rel.ends_with(".pdf") {
        rel.truncate(rel.len() - 4);
    }
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
            strip_known_doc_ext(&mut to_rel);
            to_rel.push_str(".drawio");
        }
        return to_rel;
    }
    if is_mdlnks(&from_name) {
        if !to_rel.ends_with(".mdlnks") {
            strip_known_doc_ext(&mut to_rel);
            to_rel.push_str(".mdlnks");
        }
        return to_rel;
    }
    if is_mddict(&from_name) {
        if !to_rel.ends_with(".mddict") {
            strip_known_doc_ext(&mut to_rel);
            to_rel.push_str(".mddict");
        }
        return to_rel;
    }
    if is_mdhabit(&from_name) {
        if !to_rel.ends_with(".mdhabit") {
            strip_known_doc_ext(&mut to_rel);
            to_rel.push_str(".mdhabit");
        }
        return to_rel;
    }
    if is_pdf(&from_name) {
        if !to_rel.ends_with(".pdf") {
            strip_known_doc_ext(&mut to_rel);
            to_rel.push_str(".pdf");
        }
        return to_rel;
    }
    if is_markdown(&from_name)
        && !to_rel.ends_with(".md")
        && !to_rel.ends_with(".drawio")
        && !to_rel.ends_with(".mdlnks")
        && !to_rel.ends_with(".mddict")
        && !to_rel.ends_with(".mdhabit")
        && !to_rel.ends_with(".pdf")
    {
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
        } else {
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

pub(crate) fn get_root(state: &VaultState) -> Result<PathBuf, String> {
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
        if path.is_dir() || path.is_file() {
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

#[tauri::command(async)]
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
    start_watcher(app.clone(), &state, &root)?;
    crate::embeddings::notify_vault_opened(&app, &root);
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
                    if rel.ends_with(".md")
                        || rel.ends_with(".pdf")
                        || path.is_dir()
                        || matches!(
                            event.kind,
                            notify::EventKind::Remove(_) | notify::EventKind::Modify(_)
                        )
                    {
                        if rel.ends_with(".md") || rel.ends_with(".pdf") {
                            crate::embeddings::notify_file_changed(&rel);
                        } else if matches!(event.kind, notify::EventKind::Remove(_)) {
                            crate::embeddings::notify_file_removed(&rel);
                        }
                    }
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

#[tauri::command(async)]
pub fn list_tree(state: State<VaultState>) -> Result<TreeNode, String> {
    let root = get_root(&state)?;
    let order = read_order(&root);
    make_root_node(&root, &order)
}

/// Normalize EOLs to LF so BlockNote's markdown parser can detect fenced code.
fn normalize_newlines(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

#[tauri::command(async)]
pub fn read_note(path: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let full = ensure_inside(&root, Path::new(&path))?;
    if !full.is_file() {
        return Err("Note not found".into());
    }
    let raw = fs::read_to_string(&full).map_err(|e| format!("Cannot read note: {e}"))?;
    Ok(normalize_newlines(&raw))
}

#[tauri::command(async)]
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
        crate::embeddings::notify_file_changed(&rel);
    }
    Ok(())
}

#[tauri::command(async)]
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
    crate::embeddings::notify_file_changed(&created);
    let parent = parent_rel(&created);
    let name = entry_name(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(created)
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn create_mdlnks(path: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let mut rel = path.trim().trim_start_matches('/').to_string();
    if !rel.ends_with(".mdlnks") {
        strip_known_doc_ext(&mut rel);
        rel.push_str(".mdlnks");
    }
    let full = ensure_inside(&root, Path::new(&rel))?;
    if full.exists() {
        return Err("Links file already exists".into());
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;
    }
    fs::write(&full, EMPTY_MDLNKS).map_err(|e| format!("Cannot create links file: {e}"))?;

    let created = relative_to_root(&root, &full);
    let parent = parent_rel(&created);
    let name = entry_name(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(created)
}

#[tauri::command(async)]
pub fn create_mddict(path: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let mut rel = path.trim().trim_start_matches('/').to_string();
    if !rel.ends_with(".mddict") {
        strip_known_doc_ext(&mut rel);
        rel.push_str(".mddict");
    }
    let full = ensure_inside(&root, Path::new(&rel))?;
    if full.exists() {
        return Err("Dictionary file already exists".into());
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;
    }
    fs::write(&full, EMPTY_MDDICT).map_err(|e| format!("Cannot create dictionary file: {e}"))?;

    let created = relative_to_root(&root, &full);
    let parent = parent_rel(&created);
    let name = entry_name(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(created)
}

fn valid_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..10].iter().all(u8::is_ascii_digit)
}

#[tauri::command(async)]
pub fn create_mdhabit(
    path: String,
    year: i32,
    created: String,
    state: State<VaultState>,
) -> Result<String, String> {
    if !(1..=9999).contains(&year) {
        return Err("Invalid year".into());
    }
    let created = created.trim().to_string();
    if !valid_iso_date(&created) {
        return Err("Invalid created date (expected YYYY-MM-DD)".into());
    }
    let root = get_root(&state)?;
    let mut rel = path.trim().trim_start_matches('/').to_string();
    if !rel.ends_with(".mdhabit") {
        strip_known_doc_ext(&mut rel);
        rel.push_str(".mdhabit");
    }
    let full = ensure_inside(&root, Path::new(&rel))?;
    if full.exists() {
        return Err("Habit tracker already exists".into());
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders: {e}"))?;
    }
    let seed = format!("# MarkSpace habits v1\nyear: {year}\ncreated: {created}\n");
    fs::write(&full, seed).map_err(|e| format!("Cannot create habit tracker: {e}"))?;

    let created_path = relative_to_root(&root, &full);
    let parent = parent_rel(&created_path);
    let name = entry_name(&created_path);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(created_path)
}

/// Resolve a .drawio path for embedding next to a note.
/// If `source` is already inside the vault, returns its vault-relative path.
/// Otherwise copies the file into the note's folder and returns the new relative path.
#[tauri::command(async)]
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
/// Vault documents (`.md` / `.drawio` / `.mdlnks` / `.mddict` / `.mdhabit` / `.pdf`) are imported;
/// directory structure is preserved. When `overwrite` is false, name conflicts get a
/// unique sibling (`note-1.md`). When true, existing files are replaced and folders merge.
#[tauri::command(async)]
pub fn import_paths(
    parent: String,
    sources: Vec<String>,
    overwrite: Option<bool>,
    state: State<VaultState>,
) -> Result<Vec<String>, String> {
    let overwrite = overwrite.unwrap_or(false);
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
            overwrite,
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
            crate::embeddings::notify_file_changed(rel);
        } else if is_pdf(rel) {
            crate::embeddings::notify_file_changed(rel);
        }
    }
    Ok(created)
}

fn import_dest_name(dest_dir: &Path, name: &str, overwrite: bool) -> String {
    if overwrite {
        sanitize_asset_filename(name)
    } else {
        unique_filename(dest_dir, name)
    }
}

fn import_path_recursive(
    root: &Path,
    root_canon: &Path,
    dest_dir: &Path,
    dest_parent_rel: &str,
    source: &Path,
    overwrite: bool,
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
        let dest_name = import_dest_name(dest_dir, &name, overwrite);
        let dest = dest_dir.join(&dest_name);
        if dest.exists() && dest.is_dir() {
            return Err(format!(
                "Cannot overwrite folder with file: {}",
                dest.display()
            ));
        }
        let existed = dest.is_file();
        fs::copy(&source_canon, &dest)
            .map_err(|e| format!("Cannot copy {}: {e}", source.display()))?;
        let rel = relative_to_root(root_canon, &dest);
        if !existed {
            order_insert_child(order, dest_parent_rel, &dest_name, None);
        }
        created.push(rel);
        return Ok(());
    }

    if source_canon.is_dir() {
        let dest_name = import_dest_name(dest_dir, &name, overwrite);
        let next_dir = dest_dir.join(&dest_name);
        if next_dir.exists() && next_dir.is_file() {
            return Err(format!(
                "Cannot overwrite file with folder: {}",
                next_dir.display()
            ));
        }
        let existed = next_dir.is_dir();
        fs::create_dir_all(&next_dir).map_err(|e| format!("Cannot create folder: {e}"))?;
        let next_rel = join_parent(dest_parent_rel, &dest_name);
        if !existed {
            order_insert_child(order, dest_parent_rel, &dest_name, None);
            created.push(next_rel.clone());
        }

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
                overwrite,
                order,
                created,
            )?;
        }
    }

    Ok(())
}

/// Write a vault document from clipboard/file bytes into a folder.
#[tauri::command(async)]
pub fn import_document_bytes(
    parent: String,
    file_name: String,
    data_base64: String,
    overwrite: Option<bool>,
    state: State<VaultState>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let overwrite = overwrite.unwrap_or(false);
    let root = get_root(&state)?;
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve vault root: {e}"))?;
    let parent_rel = parent.trim().trim_start_matches('/').to_string();
    let name = sanitize_asset_filename(&file_name);
    if !is_vault_document(&name) {
        return Err(
            "Only .md, .drawio, .mdlnks, .mddict, .mdhabit, and .pdf files can be imported".into(),
        );
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

    let dest_name = import_dest_name(&dest_dir, &name, overwrite);
    let dest = dest_dir.join(&dest_name);
    if dest.exists() && dest.is_dir() {
        return Err(format!(
            "Cannot overwrite folder with file: {}",
            dest.display()
        ));
    }
    let existed = dest.is_file();
    fs::write(&dest, data).map_err(|e| format!("Cannot write file: {e}"))?;

    let created = relative_to_root(&root_canon, &dest);
    let mut order = read_order(&root);
    if !existed {
        order_insert_child(&mut order, &parent_rel, &dest_name, None);
    }
    write_order(&root, &order)?;
    if is_markdown(&created) {
        if let Ok(text) = fs::read_to_string(&dest) {
            set_tag_index_path(&state, &created, tags_from_note_content(&text));
        }
        crate::embeddings::notify_file_changed(&created);
    } else if is_pdf(&created) {
        crate::embeddings::notify_file_changed(&created);
    }
    Ok(created)
}

#[tauri::command(async)]
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnsureFolderResult {
    pub path: String,
    pub created: bool,
}

/// Create a folder (and parents) if missing. `created=false` when it already existed.
#[tauri::command(async)]
pub fn ensure_folder(
    path: String,
    state: State<VaultState>,
) -> Result<EnsureFolderResult, String> {
    let root = get_root(&state)?;
    let rel = path.trim().trim_start_matches('/').trim_end_matches('/').to_string();
    if rel.is_empty() {
        return Err("Folder name required".into());
    }
    let full = ensure_inside(&root, Path::new(&rel))?;
    if full.is_file() {
        return Err("Path exists as a file".into());
    }
    if full.is_dir() {
        return Ok(EnsureFolderResult {
            path: relative_to_root(&root, &full),
            created: false,
        });
    }

    fs::create_dir_all(&full).map_err(|e| format!("Cannot create folder: {e}"))?;
    let created = relative_to_root(&root, &full);
    let parent = parent_rel(&created);
    let name = entry_name(&created);
    let mut order = read_order(&root);
    order_insert_child(&mut order, &parent, &name, None);
    write_order(&root, &order)?;

    Ok(EnsureFolderResult {
        path: created,
        created: true,
    })
}

/// Ensure `{folder}/.folder.md` exists (hidden overview note). Does not touch order.json.
#[tauri::command(async)]
pub fn ensure_folder_note(folder: String, state: State<VaultState>) -> Result<String, String> {
    let root = get_root(&state)?;
    let folder_rel = folder
        .trim()
        .trim_start_matches('/')
        .trim_end_matches('/')
        .to_string();
    if folder_rel.is_empty() {
        return Err("Vault root has no folder note".into());
    }
    let dir = ensure_inside(&root, Path::new(&folder_rel))?;
    if !dir.is_dir() {
        return Err(format!("Not a folder: {folder_rel}"));
    }
    let note_rel = folder_note_rel(&folder_rel);
    let full = ensure_inside(&root, Path::new(&note_rel))?;
    if !full.exists() {
        let title = entry_name(&folder_rel);
        // Heading + blank line + empty line for the caret (second blank line).
        let content = format!("# {title}\n\n\n");
        fs::write(&full, &content).map_err(|e| format!("Cannot create folder note: {e}"))?;
        set_tag_index_path(&state, &note_rel, Vec::new());
        crate::embeddings::notify_file_changed(&note_rel);
    }
    Ok(note_rel)
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFolderIfEmptyResult {
    pub path: String,
    pub deleted: bool,
    /// When not deleted: `not_found` | `not_a_folder` | `not_empty` | `protected`.
    pub reason: Option<String>,
}

/// Delete a folder only if it has no entries (including hidden like `.assets`).
#[tauri::command(async)]
pub fn delete_folder_if_empty(
    path: String,
    state: State<VaultState>,
) -> Result<DeleteFolderIfEmptyResult, String> {
    let root = get_root(&state)?;
    let rel_in = path.trim().trim_start_matches('/').trim_end_matches('/').to_string();
    if rel_in.is_empty() {
        return Err("Cannot delete vault root".into());
    }
    let full = ensure_inside(&root, Path::new(&rel_in))?;
    let rel = relative_to_root(&root, &full);

    if is_skills_folder(&rel) {
        return Ok(DeleteFolderIfEmptyResult {
            path: rel,
            deleted: false,
            reason: Some("protected".into()),
        });
    }
    if !full.exists() {
        return Ok(DeleteFolderIfEmptyResult {
            path: rel_in,
            deleted: false,
            reason: Some("not_found".into()),
        });
    }
    if !full.is_dir() {
        return Ok(DeleteFolderIfEmptyResult {
            path: rel,
            deleted: false,
            reason: Some("not_a_folder".into()),
        });
    }

    // `remove_dir` fails unless the directory is truly empty.
    match fs::remove_dir(&full) {
        Ok(()) => {
            let parent = parent_rel(&rel);
            let name = entry_name(&rel);
            let mut order = read_order(&root);
            order_remove_child(&mut order, &parent, &name);
            order_remove_subtree(&mut order, &rel);
            write_order(&root, &order)?;
            let _ = crate::favorites::remap_favorites(&root, &rel, None);
            let _ = crate::projects::remap_project_properties(&root, &rel, None);
            let _ = crate::agent_memory::remap_agent_memory(&root, &rel, None);
            let _ = crate::filemeta::remap_filemeta(&root, &rel, None);
            let _ = crate::comments::remap_comments(&root, &rel, None);
            let _ = crate::dict_progress::remap_dict_progress(&root, &rel, None);
            Ok(DeleteFolderIfEmptyResult {
                path: rel,
                deleted: true,
                reason: None,
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::DirectoryNotEmpty => {
            Ok(DeleteFolderIfEmptyResult {
                path: rel,
                deleted: false,
                reason: Some("not_empty".into()),
            })
        }
        Err(e) => Err(format!("Cannot delete folder: {e}")),
    }
}

#[tauri::command(async)]
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
    let _ = crate::agent_memory::remap_agent_memory(&root, &from_rel, Some(&to_rel));
    let _ = crate::filemeta::remap_filemeta(&root, &from_rel, Some(&to_rel));
    let _ = crate::comments::remap_comments(&root, &from_rel, Some(&to_rel));
    let _ = crate::dict_progress::remap_dict_progress(&root, &from_rel, Some(&to_rel));
    remap_tag_index_path(&state, &from_rel, Some(&to_rel));
    crate::embeddings::notify_file_renamed(&from_rel, &to_rel);

    Ok(to_rel)
}

#[tauri::command(async)]
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
        let _ = crate::agent_memory::remap_agent_memory(&root, &from, Some(&new_rel));
        let _ = crate::filemeta::remap_filemeta(&root, &from, Some(&new_rel));
        let _ = crate::comments::remap_comments(&root, &from, Some(&new_rel));
        let _ = crate::dict_progress::remap_dict_progress(&root, &from, Some(&new_rel));
        remap_tag_index_path(&state, &from, Some(&new_rel));
        crate::embeddings::notify_file_renamed(&from, &new_rel);
    }

    Ok(if same_parent { from } else { new_rel })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PromoteNoteToFolderResult {
    /// New folder created from the note stem (`Note.md` → `Note/`).
    pub folder: String,
    /// Former note path now living at `{folder}/.folder.md`.
    pub folder_note: String,
    /// Original note path (before promotion).
    pub former_note: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NestUnderNoteResult {
    /// New folder created from the target note stem.
    pub folder: String,
    /// Former note path now living at `{folder}/.folder.md`.
    pub folder_note: String,
    /// Path of the dragged entry after the move into `folder`.
    pub moved: String,
    /// Original target note path (before promotion).
    pub former_note: String,
}

/// Promote a markdown note to a folder with a hidden overview note
/// (`Note.md` → `Note/.folder.md`). Shared by the context-menu action and DnD nest.
fn promote_note_to_folder_inner(
    root: &Path,
    state: &VaultState,
    note: &str,
) -> Result<PromoteNoteToFolderResult, String> {
    let note = note.trim().trim_start_matches('/').to_string();
    if note.is_empty() {
        return Err("Note path required".into());
    }
    if note == SKILLS_FOLDER || note.starts_with(&format!("{SKILLS_FOLDER}/")) {
        return Err("Cannot promote a Skills note to a folder".into());
    }

    let note_name = entry_name(&note);
    if !is_markdown(&note_name) || is_folder_note_name(&note_name) {
        return Err("Only a markdown note can be turned into a folder".into());
    }

    let note_full = ensure_inside(root, Path::new(&note))?;
    if !note_full.is_file() {
        return Err("Path is not a note file".into());
    }

    let stem = note_full
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Invalid note name".to_string())?;
    if stem.starts_with('.') {
        return Err("Cannot promote a hidden note to a folder".into());
    }

    let note_parent = parent_rel(&note);
    let folder_rel = join_parent(&note_parent, &stem);
    let folder_full = ensure_inside(root, Path::new(&folder_rel))?;
    if folder_full.exists() {
        return Err(format!("Folder already exists: {folder_rel}"));
    }

    fs::create_dir_all(&folder_full).map_err(|e| format!("Cannot create folder: {e}"))?;

    let folder_note_path = folder_note_rel(&folder_rel);
    let folder_note_full = ensure_inside(root, Path::new(&folder_note_path))?;
    fs::rename(&note_full, &folder_note_full)
        .map_err(|e| format!("Cannot promote note to folder note: {e}"))?;
    maybe_migrate_moved_note(root, &note, &folder_note_path, true)?;

    let mut order = read_order(root);
    materialize_parent_order(root, &mut order, &note_parent)?;
    let list = order.entry(note_parent.clone()).or_default();
    let insert_at = list.iter().position(|n| n == &note_name).unwrap_or(list.len());
    list.retain(|n| n != &note_name);
    let idx = insert_at.min(list.len());
    list.insert(idx, stem.clone());
    // Folder note is hidden — keep it out of order.json.
    write_order(root, &order)?;

    remap_tag_index_path(state, &note, Some(&folder_note_path));
    crate::embeddings::notify_file_renamed(&note, &folder_note_path);
    let _ = crate::favorites::remap_favorites(root, &note, Some(&folder_note_path));
    let _ = crate::filemeta::remap_filemeta(root, &note, Some(&folder_note_path));
    let _ = crate::comments::remap_comments(root, &note, Some(&folder_note_path));
    let _ = crate::dict_progress::remap_dict_progress(root, &note, Some(&folder_note_path));
    // Project properties key off folder paths; a note was never a project root.

    Ok(PromoteNoteToFolderResult {
        folder: folder_rel,
        folder_note: folder_note_path,
        former_note: note,
    })
}

/// Turn a markdown note into a folder (`Note.md` → `Note/.folder.md`).
#[tauri::command(async)]
pub fn promote_note_to_folder(
    note: String,
    state: State<VaultState>,
) -> Result<PromoteNoteToFolderResult, String> {
    let root = get_root(&state)?;
    promote_note_to_folder_inner(&root, &state, &note)
}

/// Drop a vault entry onto a markdown note: the note becomes a folder
/// (`Note.md` → `Note/.folder.md`), then `from` moves into that folder.
#[tauri::command(async)]
pub fn nest_under_note(
    from: String,
    note: String,
    to_index: usize,
    state: State<VaultState>,
) -> Result<NestUnderNoteResult, String> {
    let root = get_root(&state)?;
    let from = from.trim().trim_start_matches('/').to_string();
    let note = note.trim().trim_start_matches('/').to_string();

    if from.is_empty() {
        return Err("Cannot move vault root".into());
    }
    if note.is_empty() {
        return Err("Target note required".into());
    }
    if from == note {
        return Err("Cannot nest a note into itself".into());
    }
    if is_descendant_or_same(&from, &note) {
        return Err("Cannot move a folder into one of its notes".into());
    }
    if is_skills_folder(&from) {
        return Err("Cannot move the Skills folder".into());
    }

    // Pre-check folder destination vs `from` before promoting (promotion is not reversible).
    let note_name = entry_name(&note);
    if is_markdown(&note_name) && !is_folder_note_name(&note_name) {
        let note_full = ensure_inside(&root, Path::new(&note))?;
        if note_full.is_file() {
            if let Some(stem) = note_full
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .filter(|s| !s.is_empty())
            {
                let folder_rel = join_parent(&parent_rel(&note), &stem);
                if is_descendant_or_same(&from, &folder_rel) {
                    return Err("Cannot move a folder into itself".into());
                }
            }
        }
    }

    let promoted = promote_note_to_folder_inner(&root, &state, &note)?;
    let moved = move_entry(from, promoted.folder.clone(), to_index, state)?;

    Ok(NestUnderNoteResult {
        folder: promoted.folder,
        folder_note: promoted.folder_note,
        moved,
        former_note: promoted.former_note,
    })
}

#[tauri::command(async)]
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
    let _ = crate::agent_memory::remap_agent_memory(&root, &rel, None);
    let _ = crate::filemeta::remap_filemeta(&root, &rel, None);
    let _ = crate::comments::remap_comments(&root, &rel, None);
    let _ = crate::dict_progress::remap_dict_progress(&root, &rel, None);
    remove_tag_index_path(&state, &rel);
    crate::embeddings::notify_file_removed(&rel);
    Ok(())
}

#[tauri::command(async)]
pub fn resolve_wiki_target(
    target: String,
    state: State<VaultState>,
) -> Result<Option<String>, String> {
    let root = get_root(&state)?;
    let target = target.trim().trim_start_matches('/');
    let lower = target.to_lowercase();
    let direct = if lower.ends_with(".md")
        || lower.ends_with(".pdf")
        || lower.ends_with(".drawio")
        || lower.ends_with(".mdlnks")
        || lower.ends_with(".mddict")
        || lower.ends_with(".mdhabit")
    {
        target.to_string()
    } else {
        format!("{target}.md")
    };

    let direct_path = ensure_inside(&root, Path::new(&direct))?;
    if direct_path.is_file() {
        return Ok(Some(relative_to_root(&root, &direct_path)));
    }

    // Folder wiki target → hidden folder note path (may not exist yet).
    // Specialized document extensions are never folders.
    let folder_candidate = if lower.ends_with(".pdf")
        || lower.ends_with(".drawio")
        || lower.ends_with(".mdlnks")
        || lower.ends_with(".mddict")
        || lower.ends_with(".mdhabit")
    {
        None
    } else if lower.ends_with(".md") {
        Some(target[..target.len() - 3].to_string())
    } else {
        Some(target.to_string())
    };
    if let Some(folder_candidate) = folder_candidate {
        if !folder_candidate.is_empty() {
            if let Ok(folder_path) = ensure_inside(&root, Path::new(&folder_candidate)) {
                if folder_path.is_dir() {
                    let rel = relative_to_root(&root, &folder_path);
                    return Ok(Some(folder_note_rel(&rel)));
                }
            }
        }
    }

    let needle = Path::new(target)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| target.to_string())
        .to_lowercase();

    // When the wiki target names an extension, prefer that document kind in the
    // basename walk. Bare names may match any vault document type (not only .md).
    let prefer_ext: Option<&str> = if lower.ends_with(".pdf") {
        Some("pdf")
    } else if lower.ends_with(".mddict") {
        Some("mddict")
    } else if lower.ends_with(".mdlnks") {
        Some("mdlnks")
    } else if lower.ends_with(".mdhabit") {
        Some("mdhabit")
    } else if lower.ends_with(".drawio") {
        Some("drawio")
    } else if lower.ends_with(".md") {
        Some("md")
    } else {
        None
    };

    // Basename walk: prefer a matching folder (folder note) over a distant file.
    // Skip folder matching for specialized document extensions — those are never folders.
    let allow_folder_match = prefer_ext.is_none() || prefer_ext == Some("md");
    if allow_folder_match {
        for entry in WalkDir::new(&root)
            .into_iter()
            .filter_entry(|e| {
                if e.depth() == 0 {
                    return true;
                }
                e.file_name()
                    .to_str()
                    .map(walk_entry_allowed)
                    .unwrap_or(false)
            })
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if path.components().any(|c| {
                matches!(c, Component::Normal(n) if is_skipped_hidden_component(&n.to_string_lossy()))
            }) {
                continue;
            }
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.to_lowercase() == needle {
                let rel = relative_to_root(&root, path);
                return Ok(Some(folder_note_rel(&rel)));
            }
        }
    }

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            e.file_name()
                .to_str()
                .map(walk_entry_allowed)
                .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.components().any(|c| {
            matches!(c, Component::Normal(n) if is_skipped_hidden_component(&n.to_string_lossy()))
        }) {
            continue;
        }
        let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("");
        let ext_ok = match prefer_ext {
            Some(want) => ext.eq_ignore_ascii_case(want),
            None => {
                ext.eq_ignore_ascii_case("md")
                    || ext.eq_ignore_ascii_case("pdf")
                    || ext.eq_ignore_ascii_case("drawio")
                    || ext.eq_ignore_ascii_case("mdlnks")
                    || ext.eq_ignore_ascii_case("mddict")
                    || ext.eq_ignore_ascii_case("mdhabit")
            }
        };
        if !ext_ok {
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

#[tauri::command(async)]
pub fn get_vault_path(state: State<VaultState>) -> Result<Option<String>, String> {
    let guard = state.root.lock().map_err(|_| "Vault state lock poisoned")?;
    Ok(guard.as_ref().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command(async)]
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
    /// 1-based PDF page when the hit comes from a PDF; omitted/null for markdown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<usize>,
}

#[tauri::command(async)]
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
                .map(walk_entry_allowed)
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
        if !is_markdown(&name) && !is_pdf(&name) {
            continue;
        }
        files_searched += 1;
        let full = entry.path();
        let rel = relative_to_root(&root, full);

        if is_pdf(&name) {
            let Ok(bytes) = fs::read(full) else {
                continue;
            };
            let Ok(pages) = crate::pdf_text::extract_pdf_pages(&bytes) else {
                continue;
            };
            let mut file_hits = 0usize;
            for (idx, page_text) in pages.iter().enumerate() {
                if file_hits >= MAX_HITS_PER_FILE || hits.len() >= MAX_TOTAL {
                    break;
                }
                if !page_text.to_lowercase().contains(&q_lower) {
                    continue;
                }
                let snippet = page_text
                    .lines()
                    .find(|line| line.to_lowercase().contains(&q_lower))
                    .unwrap_or(page_text)
                    .trim();
                let snippet = if snippet.chars().count() > 200 {
                    let truncated: String = snippet.chars().take(200).collect();
                    format!("{truncated}…")
                } else {
                    snippet.to_string()
                };
                let page = idx + 1;
                hits.push(SearchHit {
                    path: rel.clone(),
                    line: page,
                    snippet,
                    page: Some(page),
                });
                file_hits += 1;
            }
            continue;
        }

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
                    page: None,
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
    // Pure digit sequences (`#5`, `#42`) are not tags.
    if t.chars().all(|c| c.is_numeric()) {
        return None;
    }
    Some(t.to_string())
}

/// Some writers emit tag items as YAML maps (`- name: work`, `- {tag: work}`)
/// instead of scalars. Take the mapped value so the catalog keeps clean names.
fn unwrap_tag_mapping(raw: &str) -> &str {
    let mut value = raw.trim();
    if let Some(inner) = value.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
        value = inner.trim();
    }
    for key in ["name:", "tag:", "title:"] {
        if let Some(rest) = value.strip_prefix(key) {
            let rest = rest.trim();
            if !rest.is_empty() && !rest.contains(':') {
                return rest;
            }
        }
    }
    value
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
                    let part = unwrap_tag_mapping(part).trim_matches('"').trim_matches('\'');
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
                let part = unwrap_tag_mapping(item)
                    .trim_matches('"')
                    .trim_matches('\'');
                if let Some(name) = normalize_tag_name(part) {
                    tags.push(name);
                }
            }
            // Anything else indented under `tags:` is a continuation (further
            // keys of a mapping item, or a bare `-`): skip without ending the list.
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
                .map(walk_entry_allowed)
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
    for (rel, tags) in crate::filemeta::load_all_filemeta_tags(root) {
        if tags.is_empty() {
            continue;
        }
        // Filemeta wins for its path (PDF etc.); md paths shouldn't share sidecars.
        index.insert(rel, tags);
    }
    index
}

pub(crate) fn set_tag_index_path(state: &VaultState, rel: &str, tags: Vec<String>) {
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

const MONTH_ABBR: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

fn month_abbr_index(abbr: &str) -> Option<u32> {
    MONTH_ABBR
        .iter()
        .position(|a| a.eq_ignore_ascii_case(abbr))
        .map(|i| i as u32)
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Parse `{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md` → (year, month 1-based, day).
fn parse_daily_note_date(rel: &str) -> Option<(i32, u32, u32)> {
    let rel = rel.trim_start_matches('/');
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() != 4 {
        return None;
    }
    let folder_year: i32 = parts[1].parse().ok()?;
    let folder_month: u32 = parts[2].parse().ok()?;
    if parts[2].len() != 2 || folder_month < 1 || folder_month > 12 {
        return None;
    }
    let filename = parts[3];
    if !filename.ends_with(".md") {
        return None;
    }
    let stem = &filename[..filename.len() - 3];
    let segs: Vec<&str> = stem.split('.').collect();
    if segs.len() != 3 {
        return None;
    }
    if segs[0].len() != 2 || segs[2].len() != 4 {
        return None;
    }
    let day: u32 = segs[0].parse().ok()?;
    let month_idx = month_abbr_index(segs[1])?;
    let year: i32 = segs[2].parse().ok()?;
    if folder_year != year || folder_month != month_idx + 1 {
        return None;
    }
    if day < 1 || day > days_in_month(year, month_idx + 1) {
        return None;
    }
    Some((year, month_idx + 1, day))
}

fn iso_date_ymd(year: i32, month: u32, day: u32) -> String {
    format!("{year:04}-{month:02}-{day:02}")
}

/// Top-level YAML `marker:` scalar, if present and non-empty.
fn marker_from_frontmatter_yaml(yaml: &str) -> Option<String> {
    for raw_line in yaml.lines() {
        if raw_line.starts_with(' ') || raw_line.starts_with('\t') {
            continue;
        }
        let trimmed = raw_line.trim();
        let Some(rest) = trimmed.strip_prefix("marker:") else {
            continue;
        };
        let mut value = rest.trim();
        if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            value = &value[1..value.len() - 1];
        }
        let value = value.trim();
        if value.is_empty() {
            return None;
        }
        return Some(value.to_string());
    }
    None
}

#[derive(Debug, Serialize, Clone)]
pub struct DiaryDayMarker {
    pub date: String,
    pub marker: String,
}

/// Walk a diary project for daily notes that have YAML `marker:`.
#[tauri::command(async)]
pub fn list_diary_day_markers(
    project: String,
    state: State<VaultState>,
) -> Result<Vec<DiaryDayMarker>, String> {
    let root = get_root(&state)?;
    let rel = project.trim().trim_start_matches('/').to_string();
    if rel.is_empty() || rel.contains("..") {
        return Err("Diary project path required".into());
    }
    let project_dir = ensure_inside(&root, Path::new(&rel))?;
    if !project_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out: Vec<DiaryDayMarker> = Vec::new();
    for entry in WalkDir::new(&project_dir)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            e.file_name()
                .to_str()
                .map(walk_entry_allowed)
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
        let note_rel = relative_to_root(&root, entry.path());
        let Some((year, month, day)) = parse_daily_note_date(&note_rel) else {
            continue;
        };
        let Ok(text) = fs::read_to_string(entry.path()) else {
            continue;
        };
        let Some(yaml) = frontmatter_yaml(&text) else {
            continue;
        };
        let Some(marker) = marker_from_frontmatter_yaml(yaml) else {
            continue;
        };
        out.push(DiaryDayMarker {
            date: iso_date_ymd(year, month, day),
            marker,
        });
    }
    out.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(out)
}

#[tauri::command(async)]
pub fn list_vault_tags(state: State<VaultState>) -> Result<Vec<String>, String> {
    let guard = state
        .tag_index
        .lock()
        .map_err(|_| "Tag index lock poisoned")?;
    Ok(unique_sorted_tags(&guard))
}

/// Collect unique tags from all `.mddict` files (`filter:` + per-entry `tags:`).
/// Separate from the note/PDF tag index — never fed into the tag graph.
#[tauri::command(async)]
pub fn list_dictionary_tags(state: State<VaultState>) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    let mut seen: HashMap<String, String> = HashMap::new();
    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            e.file_name()
                .to_str()
                .map(walk_entry_allowed)
                .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !is_mddict(&name) {
            continue;
        }
        let Ok(text) = fs::read_to_string(entry.path()) else {
            continue;
        };
        for tag in tags_from_mddict_content(&text) {
            let key = tag.to_lowercase();
            seen.entry(key).or_insert(tag);
        }
    }
    let mut out: Vec<String> = seen.into_values().collect();
    out.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(out)
}

fn tags_from_mddict_content(content: &str) -> Vec<String> {
    let mut seen: HashMap<String, String> = HashMap::new();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        let value = if let Some(rest) = line
            .strip_prefix("filter:")
            .or_else(|| line.strip_prefix("Filter:"))
            .or_else(|| line.strip_prefix("FILTER:"))
        {
            rest
        } else if let Some(rest) = line
            .strip_prefix("tags:")
            .or_else(|| line.strip_prefix("Tags:"))
            .or_else(|| line.strip_prefix("TAGS:"))
        {
            rest
        } else {
            continue;
        };
        for part in value.split(',') {
            let t = part.trim();
            if t.is_empty() {
                continue;
            }
            let key = t.to_lowercase();
            seen.entry(key).or_insert_with(|| t.to_string());
        }
    }
    seen.into_values().collect()
}

/// One note's path and its tags (frontmatter ∪ inline `#tags`) from the in-memory index.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteTags {
    pub path: String,
    pub tags: Vec<String>,
}

/// Full path → tags map for the tag graph view (only notes that have at least one tag).
#[tauri::command(async)]
pub fn list_note_tags(state: State<VaultState>) -> Result<Vec<NoteTags>, String> {
    let guard = state
        .tag_index
        .lock()
        .map_err(|_| "Tag index lock poisoned")?;
    let mut out: Vec<NoteTags> = guard
        .iter()
        .map(|(path, tags)| NoteTags {
            path: path.clone(),
            tags: tags.clone(),
        })
        .collect();
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

/// One note and the existing vault files its `[[wiki]]` links resolve to.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteWikilinks {
    pub path: String,
    pub targets: Vec<String>,
}

struct WikiResolveIndex {
    files_lc: HashMap<String, String>,
    folder_rel_lc: HashMap<String, String>,
    folder_name_lc: HashMap<String, String>,
    stem_ext: HashMap<(String, String), String>,
    stem_any: HashMap<String, String>,
}

fn vault_doc_ext(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    match ext.as_str() {
        "md" | "pdf" | "drawio" | "mdlnks" | "mddict" | "mdhabit" => Some(ext),
        _ => None,
    }
}

fn walk_vault_entries(root: &Path) -> impl Iterator<Item = walkdir::DirEntry> {
    WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            e.file_name()
                .to_str()
                .map(walk_entry_allowed)
                .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
        .filter(|e| {
            !e.path().components().any(|c| {
                matches!(c, Component::Normal(n) if is_skipped_hidden_component(&n.to_string_lossy()))
            })
        })
}

fn build_wiki_resolve_index(root: &Path) -> WikiResolveIndex {
    let mut files_lc = HashMap::new();
    let mut folder_rel_lc = HashMap::new();
    let mut folder_name_lc = HashMap::new();
    let mut stem_ext = HashMap::new();
    let mut stem_any = HashMap::new();

    for entry in walk_vault_entries(root) {
        let path = entry.path();
        if path == root {
            continue;
        }
        let rel = relative_to_root(root, path);
        if path.is_dir() {
            let lc = rel.to_lowercase();
            folder_rel_lc.entry(lc.clone()).or_insert_with(|| rel.clone());
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !name.is_empty() {
                folder_name_lc.entry(name).or_insert(rel);
            }
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let Some(ext) = vault_doc_ext(path) else {
            continue;
        };
        files_lc
            .entry(rel.to_lowercase())
            .or_insert_with(|| rel.clone());
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if stem.is_empty() {
            continue;
        }
        stem_ext
            .entry((stem.clone(), ext))
            .or_insert_with(|| rel.clone());
        stem_any.entry(stem).or_insert(rel);
    }

    WikiResolveIndex {
        files_lc,
        folder_rel_lc,
        folder_name_lc,
        stem_ext,
        stem_any,
    }
}

fn resolve_wiki_with_index(index: &WikiResolveIndex, target: &str) -> Option<String> {
    let target = target.trim().trim_start_matches('/');
    if target.is_empty() {
        return None;
    }
    let lower = target.to_lowercase();
    let direct = if lower.ends_with(".md")
        || lower.ends_with(".pdf")
        || lower.ends_with(".drawio")
        || lower.ends_with(".mdlnks")
        || lower.ends_with(".mddict")
        || lower.ends_with(".mdhabit")
    {
        target.to_string()
    } else {
        format!("{target}.md")
    };
    if let Some(rel) = index.files_lc.get(&direct.to_lowercase()) {
        return Some(rel.clone());
    }

    let folder_candidate = if lower.ends_with(".pdf")
        || lower.ends_with(".drawio")
        || lower.ends_with(".mdlnks")
        || lower.ends_with(".mddict")
        || lower.ends_with(".mdhabit")
    {
        None
    } else if lower.ends_with(".md") {
        Some(target[..target.len() - 3].to_string())
    } else {
        Some(target.to_string())
    };
    if let Some(folder_candidate) = folder_candidate {
        if !folder_candidate.is_empty() {
            if let Some(folder_rel) = index.folder_rel_lc.get(&folder_candidate.to_lowercase())
            {
                let note = folder_note_rel(folder_rel);
                if index.files_lc.contains_key(&note.to_lowercase()) {
                    return Some(
                        index
                            .files_lc
                            .get(&note.to_lowercase())
                            .cloned()
                            .unwrap_or(note),
                    );
                }
            }
        }
    }

    let needle = Path::new(target)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| target.to_string())
        .to_lowercase();

    let prefer_ext: Option<&str> = if lower.ends_with(".pdf") {
        Some("pdf")
    } else if lower.ends_with(".mddict") {
        Some("mddict")
    } else if lower.ends_with(".mdlnks") {
        Some("mdlnks")
    } else if lower.ends_with(".mdhabit") {
        Some("mdhabit")
    } else if lower.ends_with(".drawio") {
        Some("drawio")
    } else if lower.ends_with(".md") {
        Some("md")
    } else {
        None
    };

    let allow_folder_match = prefer_ext.is_none() || prefer_ext == Some("md");
    if allow_folder_match {
        if let Some(folder_rel) = index.folder_name_lc.get(&needle) {
            let note = folder_note_rel(folder_rel);
            if index.files_lc.contains_key(&note.to_lowercase()) {
                return Some(
                    index
                        .files_lc
                        .get(&note.to_lowercase())
                        .cloned()
                        .unwrap_or(note),
                );
            }
        }
    }

    if let Some(ext) = prefer_ext {
        if let Some(rel) = index.stem_ext.get(&(needle.clone(), ext.to_string())) {
            return Some(rel.clone());
        }
    } else if let Some(rel) = index.stem_any.get(&needle) {
        return Some(rel.clone());
    }

    None
}

fn extract_wiki_targets(content: &str) -> Vec<String> {
    let visible = strip_markdown_code_regions(content);
    let bytes = visible.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            if i > 0 && bytes[i - 1] == b'!' {
                i += 2;
                continue;
            }
            if let Some(end) = visible[i + 2..].find("]]") {
                let inner = &visible[i + 2..i + 2 + end];
                let target = inner.split('|').next().unwrap_or("").trim();
                if !target.is_empty() && !target.to_lowercase().ends_with(".drawio") {
                    out.push(target.to_string());
                }
                i += 2 + end + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn strip_markdown_code_regions(source: &str) -> String {
    let s = source;
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let bytes = s.as_bytes();
    while i < s.len() {
        if s[i..].starts_with("```") {
            if let Some(rel) = s[i + 3..].find("```") {
                let end = i + 3 + rel + 3;
                out.push_str(&" ".repeat(end - i));
                i = end;
                continue;
            }
            break;
        }
        if bytes[i] == b'`' {
            if let Some(rel) = s[i + 1..].find('`') {
                let end = i + 1 + rel + 1;
                out.push_str(&" ".repeat(end - i));
                i = end;
                continue;
            }
            out.push_str(&s[i..]);
            break;
        }
        out.push(s[i..].chars().next().unwrap());
        i += s[i..].chars().next().unwrap().len_utf8();
    }
    out
}

#[tauri::command(async)]
pub fn list_note_wikilinks(state: State<VaultState>) -> Result<Vec<NoteWikilinks>, String> {
    let root = get_root(&state)?;
    let index = build_wiki_resolve_index(&root);
    let mut out = Vec::new();

    for entry in walk_vault_entries(&root) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if !path
            .extension()
            .and_then(|x| x.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        {
            continue;
        }
        let rel = relative_to_root(&root, path);
        let text = match fs::read_to_string(path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let mut seen = HashSet::new();
        let mut targets = Vec::new();
        for target in extract_wiki_targets(&text) {
            let Some(resolved) = resolve_wiki_with_index(&index, &target) else {
                continue;
            };
            if resolved == rel {
                continue;
            }
            let key = resolved.to_lowercase();
            if !seen.insert(key) {
                continue;
            }
            targets.push(resolved);
        }
        if targets.is_empty() {
            continue;
        }
        out.push(NoteWikilinks {
            path: rel,
            targets,
        });
    }

    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

/// Re-read one note or filemeta-tagged document into the tag index.
#[tauri::command(async)]
pub fn reindex_note_tags(path: String, state: State<VaultState>) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    let rel = path.trim().trim_start_matches('/').to_string();
    let lower = rel.to_lowercase();
    if lower.ends_with(".md") {
        let full = ensure_inside(&root, Path::new(&rel))?;
        if !full.is_file() {
            remove_tag_index_path(&state, &rel);
        } else {
            let text = fs::read_to_string(&full).map_err(|e| format!("Cannot read note: {e}"))?;
            let tags = tags_from_note_content(&text);
            set_tag_index_path(&state, &rel, tags);
        }
    } else if lower.ends_with(".pdf") {
        let full = ensure_inside(&root, Path::new(&rel))?;
        if !full.is_file() {
            remove_tag_index_path(&state, &rel);
        } else {
            let tags = crate::filemeta::get_tags_for_path(&root, &rel).unwrap_or_default();
            set_tag_index_path(&state, &rel, tags);
        }
    } else {
        // Non-md / non-pdf: leave index as-is for this path.
    }
    let guard = state
        .tag_index
        .lock()
        .map_err(|_| "Tag index lock poisoned")?;
    Ok(unique_sorted_tags(&guard))
}

#[tauri::command(async)]
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
#[tauri::command(async)]
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
#[tauri::command(async)]
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

#[cfg(test)]
mod diary_marker_tests {
    use super::*;

    #[test]
    fn parse_daily_note_date_accepts_layout() {
        assert_eq!(
            parse_daily_note_date("Journal/2026/08/15.Aug.2026.md"),
            Some((2026, 8, 15))
        );
        assert_eq!(
            parse_daily_note_date("Journal/2026/01/09.Jan.2026.md"),
            Some((2026, 1, 9))
        );
        assert_eq!(parse_daily_note_date("Journal/2026/08/15.Aug.2025.md"), None);
        assert_eq!(parse_daily_note_date("Journal/2026/08/note.md"), None);
        assert_eq!(parse_daily_note_date("Journal/2026/02/31.Feb.2026.md"), None);
    }

    #[test]
    fn marker_from_yaml_reads_plain_and_quoted() {
        assert_eq!(
            marker_from_frontmatter_yaml("tags:\n  - diary\nmarker: holiday\n"),
            Some("holiday".into())
        );
        assert_eq!(
            marker_from_frontmatter_yaml("marker: \"sad\"\n"),
            Some("sad".into())
        );
        assert_eq!(marker_from_frontmatter_yaml("marker: \n"), None);
        assert_eq!(
            marker_from_frontmatter_yaml("tags:\n  - marker: nested\n"),
            None
        );
    }
}

