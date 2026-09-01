//! Task list metadata under `.markspace/task-lists/` (vault-synced).
//!
//! Lists are folders directly under `Tasks/` (e.g. `Tasks/Work`). Each list may
//! have optional `groupId`, Material swatch `color`, and sidebar `order`.
//! Groups live in `groups.json`.

use crate::vault::VaultState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

const TASKS_ROOT: &str = "Tasks";
const COMPLETED_DIR: &str = "completed";

/// Material Design 500 swatches (lowercase `#rrggbb`). Empty = unset.
const LIST_COLORS: &[&str] = &[
    "#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5", "#2196f3", "#03a9f4",
    "#00bcd4", "#009688", "#4caf50", "#8bc34a", "#cddc39", "#ffc107", "#ff9800",
    "#ff5722", "#795548", "#607d8b",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskListGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskListMeta {
    /// Vault-relative path, e.g. `Tasks/Work`.
    pub path: String,
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GroupsDoc {
    #[serde(default = "default_groups_version")]
    version: u32,
    #[serde(default)]
    groups: Vec<TaskListGroup>,
}

fn default_groups_version() -> u32 {
    1
}

fn normalize_list_color(raw: &str) -> String {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() {
        return String::new();
    }
    if LIST_COLORS.iter().any(|c| *c == trimmed) {
        trimmed
    } else {
        String::new()
    }
}

fn normalize_group_id(raw: &str) -> String {
    raw.trim().to_string()
}

fn normalize_task_list_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_matches('/').replace('\\', "/");
    if trimmed.is_empty() {
        return Err("Invalid task list path".into());
    }
    for component in Path::new(&trimmed).components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::CurDir
        ) {
            return Err("Invalid task list path".into());
        }
    }
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() != 2 || parts[0] != TASKS_ROOT {
        return Err("Task list path must be Tasks/<list>".into());
    }
    let name = parts[1];
    if name.is_empty() || name == COMPLETED_DIR {
        return Err("Invalid task list name".into());
    }
    Ok(trimmed.to_string())
}

fn list_name_from_path(path: &str) -> Option<String> {
    let Ok(rel) = normalize_task_list_path(path) else {
        return None;
    };
    rel.strip_prefix(&format!("{TASKS_ROOT}/"))
        .map(|s| s.to_string())
}

fn task_lists_dir(root: &Path) -> PathBuf {
    root.join(".markspace").join("task-lists")
}

fn groups_file(root: &Path) -> PathBuf {
    task_lists_dir(root).join("groups.json")
}

fn list_id(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn list_file_path(root: &Path, path: &str) -> PathBuf {
    task_lists_dir(root).join(format!("{}.json", list_id(path)))
}

fn path_exists_dir(root: &Path, rel: &str) -> bool {
    root.join(rel).is_dir()
}

fn get_root(state: &VaultState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "Vault state lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No vault open".to_string())
}

fn read_groups_doc(root: &Path) -> Result<GroupsDoc, String> {
    let file = groups_file(root);
    if !file.is_file() {
        return Ok(GroupsDoc {
            version: 1,
            groups: Vec::new(),
        });
    }
    let raw = fs::read_to_string(&file).map_err(|e| format!("Cannot read task list groups: {e}"))?;
    let doc: GroupsDoc =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid task list groups file: {e}"))?;
    Ok(GroupsDoc {
        version: doc.version,
        groups: doc
            .groups
            .into_iter()
            .filter(|g| !g.id.trim().is_empty() && !g.name.trim().is_empty())
            .map(|mut g| {
                g.id = g.id.trim().to_string();
                g.name = g.name.trim().to_string();
                g
            })
            .collect(),
    })
}

fn write_groups_doc(root: &Path, doc: &GroupsDoc) -> Result<(), String> {
    let dir = task_lists_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create task-lists dir: {e}"))?;
    let body = serde_json::to_string_pretty(doc)
        .map_err(|e| format!("Cannot serialize task list groups: {e}"))?;
    fs::write(groups_file(root), format!("{body}\n"))
        .map_err(|e| format!("Cannot write task list groups: {e}"))
}

fn empty_meta(path: String) -> TaskListMeta {
    TaskListMeta {
        path,
        group_id: String::new(),
        color: String::new(),
        order: 0,
    }
}

fn sanitize_meta(mut meta: TaskListMeta) -> Result<TaskListMeta, String> {
    meta.path = normalize_task_list_path(&meta.path)?;
    meta.group_id = normalize_group_id(&meta.group_id);
    meta.color = normalize_list_color(&meta.color);
    Ok(meta)
}

fn read_list_file(path: &Path) -> Option<TaskListMeta> {
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let rel = value.get("path")?.as_str()?.trim().replace('\\', "/");
    let rel = rel.trim_matches('/').to_string();
    let meta = TaskListMeta {
        path: rel,
        group_id: value
            .get("groupId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        color: value
            .get("color")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        order: value.get("order").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
    };
    sanitize_meta(meta).ok()
}

fn write_list_file(root: &Path, meta: &TaskListMeta) -> Result<(), String> {
    let meta = sanitize_meta(meta.clone())?;
    let dir = task_lists_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create task-lists dir: {e}"))?;
    let file = list_file_path(root, &meta.path);
    let body = serde_json::to_string_pretty(&json!({
        "path": meta.path,
        "groupId": meta.group_id,
        "color": meta.color,
        "order": meta.order,
    }))
    .map_err(|e| format!("Cannot serialize task list meta: {e}"))?;
    fs::write(&file, format!("{body}\n"))
        .map_err(|e| format!("Cannot write task list meta: {e}"))
}

fn remove_list_file(root: &Path, path: &str) -> Result<(), String> {
    let file = list_file_path(root, path);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("Cannot remove task list meta: {e}"))?;
    }
    Ok(())
}

fn scan_list_markers(root: &Path) -> Result<Vec<(PathBuf, TaskListMeta)>, String> {
    let dir = task_lists_dir(root);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out: Vec<(PathBuf, TaskListMeta)> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("Cannot read task-lists: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Cannot read task-lists entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name == "groups.json" || !name.ends_with(".json") {
            continue;
        }
        if let Some(meta) = read_list_file(&path) {
            out.push((path, meta));
        }
    }
    Ok(out)
}

fn clear_group_from_lists(root: &Path, group_id: &str) -> Result<(), String> {
    for (_file, mut meta) in scan_list_markers(root)? {
        if meta.group_id == group_id {
            meta.group_id = String::new();
            let _ = write_list_file(root, &meta);
        }
    }
    Ok(())
}

/// Remap list metadata after rename/move (`to = Some`) or delete (`to = None`).
pub fn remap_task_list_meta(root: &Path, from: &str, to: Option<&str>) -> Result<(), String> {
    let from = from.trim().trim_matches('/').replace('\\', "/");
    let Ok(from_path) = normalize_task_list_path(&from) else {
        return Ok(());
    };
    let to = to.and_then(|t| {
        let t = t.trim().trim_matches('/').replace('\\', "/");
        normalize_task_list_path(&t).ok()
    });

    let markers = match scan_list_markers(root) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    for (_file, meta) in markers {
        if meta.path != from_path {
            continue;
        }
        let _ = remove_list_file(root, &meta.path);
        if let Some(ref new_path) = to {
            if path_exists_dir(root, new_path) {
                let next = TaskListMeta {
                    path: new_path.clone(),
                    group_id: meta.group_id,
                    color: meta.color,
                    order: meta.order,
                };
                let _ = write_list_file(root, &next);
            }
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn list_task_list_groups(state: State<VaultState>) -> Result<Vec<TaskListGroup>, String> {
    let root = get_root(&state)?;
    let doc = read_groups_doc(&root)?;
    let mut groups = doc.groups;
    groups.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.name.cmp(&b.name)));
    Ok(groups)
}

#[tauri::command(async)]
pub fn upsert_task_list_group(
    id: String,
    name: String,
    order: i32,
    state: State<VaultState>,
) -> Result<TaskListGroup, String> {
    let root = get_root(&state)?;
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Group id is required".into());
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Group name is required".into());
    }
    let mut doc = read_groups_doc(&root)?;
    if let Some(existing) = doc.groups.iter_mut().find(|g| g.id == id) {
        existing.name = name;
        existing.order = order;
        let out = existing.clone();
        write_groups_doc(&root, &doc)?;
        return Ok(out);
    }
    let group = TaskListGroup { id, name, order };
    doc.groups.push(group.clone());
    write_groups_doc(&root, &doc)?;
    Ok(group)
}

#[tauri::command(async)]
pub fn delete_task_list_group(id: String, state: State<VaultState>) -> Result<(), String> {
    let root = get_root(&state)?;
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Group id is required".into());
    }
    let mut doc = read_groups_doc(&root)?;
    let before = doc.groups.len();
    doc.groups.retain(|g| g.id != id);
    if doc.groups.len() == before {
        return Ok(());
    }
    write_groups_doc(&root, &doc)?;
    clear_group_from_lists(&root, &id)?;
    Ok(())
}

#[tauri::command(async)]
pub fn get_task_list_meta(path: String, state: State<VaultState>) -> Result<TaskListMeta, String> {
    let root = get_root(&state)?;
    let rel = normalize_task_list_path(&path)?;
    if !path_exists_dir(&root, &rel) {
        return Err("Task list not found".into());
    }

    let file = list_file_path(&root, &rel);
    if let Some(meta) = read_list_file(&file) {
        if meta.path == rel {
            return Ok(meta);
        }
    }

    for (marker, meta) in scan_list_markers(&root)? {
        if meta.path == rel {
            let _ = fs::remove_file(&marker);
            write_list_file(&root, &meta)?;
            return Ok(meta);
        }
    }

    Ok(empty_meta(rel))
}

#[tauri::command(async)]
pub fn list_task_list_meta(state: State<VaultState>) -> Result<Vec<TaskListMeta>, String> {
    let root = get_root(&state)?;
    let mut out: Vec<TaskListMeta> = Vec::new();
    for (marker, meta) in scan_list_markers(&root)? {
        if !path_exists_dir(&root, &meta.path) {
            let _ = fs::remove_file(&marker);
            continue;
        }
        let expected = list_file_path(&root, &meta.path);
        if marker != expected {
            let _ = fs::remove_file(&marker);
            let _ = write_list_file(&root, &meta);
        }
        out.push(meta);
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

#[tauri::command(async)]
pub fn set_task_list_meta(
    path: String,
    group_id: String,
    color: String,
    order: i32,
    state: State<VaultState>,
) -> Result<TaskListMeta, String> {
    let root = get_root(&state)?;
    let rel = normalize_task_list_path(&path)?;
    if !path_exists_dir(&root, &rel) {
        return Err("Task list not found".into());
    }

    let group_id = normalize_group_id(&group_id);
    if !group_id.is_empty() {
        let doc = read_groups_doc(&root)?;
        if !doc.groups.iter().any(|g| g.id == group_id) {
            return Err("Task list group not found".into());
        }
    }

    let meta = sanitize_meta(TaskListMeta {
        path: rel,
        group_id,
        color,
        order,
    })?;

    for (marker, existing) in scan_list_markers(&root)? {
        if existing.path == meta.path && marker != list_file_path(&root, &meta.path) {
            let _ = fs::remove_file(&marker);
        }
    }

    if meta.group_id.is_empty() && meta.color.is_empty() && meta.order == 0 {
        remove_list_file(&root, &meta.path)?;
        return Ok(meta);
    }

    write_list_file(&root, &meta)?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-tasklists-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join("Tasks").join("Work")).unwrap();
        fs::create_dir_all(dir.join("Tasks").join("Home")).unwrap();
        dir
    }

    #[test]
    fn write_and_read_meta() {
        let root = temp_vault();
        let meta = TaskListMeta {
            path: "Tasks/Work".into(),
            group_id: "g1".into(),
            color: "#2196f3".into(),
            order: 2,
        };
        write_list_file(&root, &meta).unwrap();
        let file = list_file_path(&root, "Tasks/Work");
        let loaded = read_list_file(&file).unwrap();
        assert_eq!(loaded.color, "#2196f3");
        assert_eq!(loaded.group_id, "g1");
    }

    #[test]
    fn remap_on_rename() {
        let root = temp_vault();
        let meta = TaskListMeta {
            path: "Tasks/Work".into(),
            group_id: String::new(),
            color: "#4caf50".into(),
            order: 0,
        };
        write_list_file(&root, &meta).unwrap();
        fs::rename(root.join("Tasks/Work"), root.join("Tasks/Personal")).unwrap();
        remap_task_list_meta(&root, "Tasks/Work", Some("Tasks/Personal")).unwrap();
        let loaded = read_list_file(&list_file_path(&root, "Tasks/Personal")).unwrap();
        assert_eq!(loaded.path, "Tasks/Personal");
        assert_eq!(loaded.color, "#4caf50");
    }

    #[test]
    fn list_name_from_path_works() {
        assert_eq!(
            list_name_from_path("Tasks/Work"),
            Some("Work".to_string())
        );
        assert!(list_name_from_path("Tasks/Work/nested").is_none());
    }
}
