//! Agent memory: durable facts for the chat agent, stored in
//! `.markspace/agent-memory.json` (vault-synced).
//!
//! Entries are either global (`project_path = null`) or scoped to a vault
//! project (first-level folder).

use crate::vault::{get_root, VaultState};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const MAX_TEXT_CHARS: usize = 500;
const MAX_ENTRIES: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryEntry {
    pub id: String,
    pub text: String,
    /// `null` = global; otherwise a first-level project folder name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryDoc {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub entries: Vec<AgentMemoryEntry>,
}

fn default_version() -> u32 {
    1
}

fn default_enabled() -> bool {
    true
}

impl Default for AgentMemoryDoc {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: true,
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearAgentMemoryArgs {
    /// `"all"` | `"global"` | `"project"`.
    pub kind: String,
    #[serde(default)]
    pub project: Option<String>,
}

fn memory_path(root: &Path) -> PathBuf {
    root.join(".markspace").join("agent-memory.json")
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Compact UTC timestamp; fine for local vault metadata.
    format!("{secs}")
}

fn new_entry_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("m{nanos:x}")
}

fn normalize_project_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_matches('/').replace('\\', "/");
    if trimmed.is_empty() {
        return Err("Project path required".into());
    }
    if trimmed.contains('/') {
        return Err("Only first-level folders are projects".into());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("Invalid project path".into());
    }
    for component in Path::new(&trimmed).components() {
        if matches!(component, Component::ParentDir | Component::RootDir) {
            return Err("Invalid project path".into());
        }
    }
    Ok(trimmed)
}

fn is_project_path(path: &str) -> bool {
    let trimmed = path.trim().trim_matches('/').replace('\\', "/");
    !trimmed.is_empty() && !trimmed.contains('/')
}

fn path_exists_dir(root: &Path, rel: &str) -> bool {
    let p = root.join(rel);
    p.is_dir()
}

fn normalize_text(text: &str) -> Result<String, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("Memory text required".into());
    }
    if trimmed.chars().count() > MAX_TEXT_CHARS {
        return Err(format!(
            "Memory text must be at most {MAX_TEXT_CHARS} characters"
        ));
    }
    Ok(trimmed)
}

fn normalize_scope(
    root: &Path,
    project_path: Option<&str>,
    require_exists: bool,
) -> Result<Option<String>, String> {
    match project_path {
        None => Ok(None),
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            let path = normalize_project_path(trimmed)?;
            if require_exists && !path_exists_dir(root, &path) {
                return Err(format!("Project folder not found: {path}"));
            }
            Ok(Some(path))
        }
    }
}

fn load_doc(root: &Path) -> Result<AgentMemoryDoc, String> {
    let path = memory_path(root);
    if !path.exists() {
        return Ok(AgentMemoryDoc::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(AgentMemoryDoc::default());
    }
    let mut doc: AgentMemoryDoc =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid agent-memory.json: {e}"))?;
    doc.version = 1;
    // Drop invalid entries; heal project paths.
    doc.entries.retain(|e| {
        if e.text.trim().is_empty() || e.id.trim().is_empty() {
            return false;
        }
        match &e.project_path {
            None => true,
            Some(p) => is_project_path(p),
        }
    });
    if doc.entries.len() > MAX_ENTRIES {
        doc.entries.truncate(MAX_ENTRIES);
    }
    Ok(doc)
}

fn save_doc(root: &Path, doc: &AgentMemoryDoc) -> Result<(), String> {
    let markspace = root.join(".markspace");
    fs::create_dir_all(&markspace).map_err(|e| e.to_string())?;
    let path = memory_path(root);
    let body = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    fs::write(&path, format!("{body}\n")).map_err(|e| e.to_string())
}

/// Remap or drop project-scoped memories when a project folder is renamed/moved/deleted.
pub fn remap_agent_memory(root: &Path, from: &str, to: Option<&str>) -> Result<(), String> {
    let from = from.trim().trim_matches('/').replace('\\', "/");
    if !is_project_path(&from) {
        return Ok(());
    }
    let to = to.map(|t| t.trim().trim_matches('/').replace('\\', "/"));

    let mut doc = match load_doc(root) {
        Ok(d) => d,
        Err(_) => return Ok(()),
    };
    let mut changed = false;
    let mut next_entries = Vec::with_capacity(doc.entries.len());
    for entry in doc.entries.drain(..) {
        match &entry.project_path {
            Some(p) if p == &from => {
                changed = true;
                if let Some(ref new_path) = to {
                    if is_project_path(new_path) {
                        next_entries.push(AgentMemoryEntry {
                            project_path: Some(new_path.clone()),
                            updated_at: now_iso(),
                            ..entry
                        });
                    }
                    // else: drop (no longer a project)
                }
                // else: delete → drop
            }
            _ => next_entries.push(entry),
        }
    }
    if !changed {
        return Ok(());
    }
    doc.entries = next_entries;
    save_doc(root, &doc)
}

#[tauri::command]
pub fn get_agent_memory(state: State<VaultState>) -> Result<AgentMemoryDoc, String> {
    let root = get_root(&state)?;
    load_doc(&root)
}

#[tauri::command]
pub fn set_agent_memory_enabled(
    state: State<VaultState>,
    enabled: bool,
) -> Result<AgentMemoryDoc, String> {
    let root = get_root(&state)?;
    let mut doc = load_doc(&root)?;
    doc.enabled = enabled;
    save_doc(&root, &doc)?;
    Ok(doc)
}

#[tauri::command]
pub fn add_agent_memory(
    state: State<VaultState>,
    text: String,
    project_path: Option<String>,
) -> Result<AgentMemoryEntry, String> {
    let root = get_root(&state)?;
    let text = normalize_text(&text)?;
    let scope = normalize_scope(&root, project_path.as_deref(), true)?;
    let mut doc = load_doc(&root)?;
    if doc.entries.len() >= MAX_ENTRIES {
        return Err(format!("Memory limit reached ({MAX_ENTRIES} entries)"));
    }
    let now = now_iso();
    let entry = AgentMemoryEntry {
        id: new_entry_id(),
        text,
        project_path: scope,
        created_at: now.clone(),
        updated_at: now,
    };
    doc.entries.push(entry.clone());
    save_doc(&root, &doc)?;
    Ok(entry)
}

#[tauri::command]
pub fn update_agent_memory(
    state: State<VaultState>,
    id: String,
    text: String,
    project_path: Option<String>,
) -> Result<AgentMemoryEntry, String> {
    let root = get_root(&state)?;
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Memory id required".into());
    }
    let text = normalize_text(&text)?;
    let scope = normalize_scope(&root, project_path.as_deref(), true)?;
    let mut doc = load_doc(&root)?;
    let Some(entry) = doc.entries.iter_mut().find(|e| e.id == id) else {
        return Err(format!("Memory not found: {id}"));
    };
    entry.text = text;
    entry.project_path = scope;
    entry.updated_at = now_iso();
    let updated = entry.clone();
    save_doc(&root, &doc)?;
    Ok(updated)
}

#[tauri::command]
pub fn delete_agent_memory(state: State<VaultState>, id: String) -> Result<(), String> {
    let root = get_root(&state)?;
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Memory id required".into());
    }
    let mut doc = load_doc(&root)?;
    let before = doc.entries.len();
    doc.entries.retain(|e| e.id != id);
    if doc.entries.len() == before {
        return Err(format!("Memory not found: {id}"));
    }
    save_doc(&root, &doc)
}

#[tauri::command]
pub fn clear_agent_memory(
    state: State<VaultState>,
    args: ClearAgentMemoryArgs,
) -> Result<AgentMemoryDoc, String> {
    let root = get_root(&state)?;
    let mut doc = load_doc(&root)?;
    match args.kind.trim().to_ascii_lowercase().as_str() {
        "all" => {
            doc.entries.clear();
        }
        "global" => {
            doc.entries.retain(|e| e.project_path.is_some());
        }
        "project" => {
            let project = args
                .project
                .as_deref()
                .ok_or_else(|| "project required for kind=project".to_string())?;
            let path = normalize_project_path(project)?;
            doc.entries
                .retain(|e| e.project_path.as_deref() != Some(path.as_str()));
        }
        other => return Err(format!("Unknown clear kind: {other}")),
    }
    save_doc(&root, &doc)?;
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-mem-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(dir.join("Alpha")).unwrap();
        fs::create_dir_all(dir.join("Beta")).unwrap();
        dir
    }

    #[test]
    fn add_global_and_project_and_remap() {
        let root = temp_vault();
        let mut doc = AgentMemoryDoc::default();
        let now = now_iso();
        doc.entries.push(AgentMemoryEntry {
            id: "m1".into(),
            text: "Global fact".into(),
            project_path: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
        doc.entries.push(AgentMemoryEntry {
            id: "m2".into(),
            text: "Alpha fact".into(),
            project_path: Some("Alpha".into()),
            created_at: now.clone(),
            updated_at: now,
        });
        save_doc(&root, &doc).unwrap();

        remap_agent_memory(&root, "Alpha", Some("Beta")).unwrap();
        let loaded = load_doc(&root).unwrap();
        assert_eq!(loaded.entries.len(), 2);
        let alphaish = loaded
            .entries
            .iter()
            .find(|e| e.id == "m2")
            .unwrap();
        assert_eq!(alphaish.project_path.as_deref(), Some("Beta"));

        remap_agent_memory(&root, "Beta", None).unwrap();
        let loaded = load_doc(&root).unwrap();
        assert_eq!(loaded.entries.len(), 1);
        assert!(loaded.entries[0].project_path.is_none());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_oversized_text() {
        let long = "x".repeat(MAX_TEXT_CHARS + 1);
        assert!(normalize_text(&long).is_err());
        assert!(normalize_text("  hello  ").unwrap() == "hello");
    }
}
