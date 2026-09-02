//! Chat Gems — reusable agent profiles stored under `.markspace/gems/`.
//!
//! Each gem is one JSON file: name, instructions, and a required model id.

use crate::vault::VaultState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Gem {
    pub id: String,
    pub name: String,
    pub instructions: String,
    pub model_id: String,
    /// When the model supports thinking, whether to enable it for this Gem.
    #[serde(default = "default_true")]
    pub enable_reasoning: bool,
    /// Optional cap on user turns sent to the model (one user message + reply).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recent_user_turns: Option<i32>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertGemInput {
    /// Omit or empty → create a new gem.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub instructions: String,
    pub model_id: String,
    #[serde(default = "default_true")]
    pub enable_reasoning: bool,
    #[serde(default)]
    pub recent_user_turns: Option<i32>,
}

fn gems_dir(root: &Path) -> PathBuf {
    root.join(".markspace").join("gems")
}

fn gem_file_path(root: &Path, id: &str) -> PathBuf {
    gems_dir(root).join(format!("{id}.json"))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_gem_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("g{nanos:x}")
}

fn get_root(state: &VaultState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "Vault state lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No vault open".to_string())
}

fn validate_recent_user_turns(value: Option<i32>) -> Result<Option<i32>, String> {
    match value {
        None => Ok(None),
        Some(n) if n <= 0 => Err("Recent user turns must be a positive number".into()),
        Some(n) => Ok(Some(n)),
    }
}

fn validate_fields(name: &str, instructions: &str, model_id: &str) -> Result<(String, String, String), String> {
    let name = name.trim().to_string();
    let instructions = instructions.trim().to_string();
    let model_id = model_id.trim().to_string();
    if name.is_empty() {
        return Err("Gem name is required".into());
    }
    if instructions.is_empty() {
        return Err("Gem instructions are required".into());
    }
    if model_id.is_empty() {
        return Err("Gem model is required".into());
    }
    Ok((name, instructions, model_id))
}

fn is_safe_gem_id(id: &str) -> bool {
    let trimmed = id.trim();
    !trimmed.is_empty()
        && !trimmed.contains('/')
        && !trimmed.contains('\\')
        && !trimmed.contains("..")
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn read_gem_file(path: &Path) -> Option<Gem> {
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let id = value.get("id")?.as_str()?.trim().to_string();
    if !is_safe_gem_id(&id) {
        return None;
    }
    let name = value.get("name")?.as_str()?.trim().to_string();
    let instructions = value
        .get("instructions")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let model_id = value
        .get("modelId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() || instructions.is_empty() || model_id.is_empty() {
        return None;
    }
    let created_at = value
        .get("createdAt")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let updated_at = value
        .get("updatedAt")
        .and_then(|v| v.as_i64())
        .unwrap_or(created_at);
    let enable_reasoning = value
        .get("enableReasoning")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let recent_user_turns = value
        .get("recentUserTurns")
        .and_then(|v| v.as_i64())
        .and_then(|n| i32::try_from(n).ok())
        .filter(|n| *n > 0);
    Some(Gem {
        id,
        name,
        instructions,
        model_id,
        enable_reasoning,
        recent_user_turns,
        created_at,
        updated_at,
    })
}

fn write_gem_file(root: &Path, gem: &Gem) -> Result<(), String> {
    let dir = gems_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create gems dir: {e}"))?;
    let file = gem_file_path(root, &gem.id);
    let body = serde_json::to_string_pretty(&json!({
        "id": gem.id,
        "name": gem.name,
        "instructions": gem.instructions,
        "modelId": gem.model_id,
        "enableReasoning": gem.enable_reasoning,
        "recentUserTurns": gem.recent_user_turns,
        "createdAt": gem.created_at,
        "updatedAt": gem.updated_at,
    }))
    .map_err(|e| format!("Cannot serialize gem: {e}"))?;
    fs::write(&file, format!("{body}\n")).map_err(|e| format!("Cannot write gem: {e}"))
}

fn scan_gems(root: &Path) -> Result<Vec<Gem>, String> {
    let dir = gems_dir(root);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out: Vec<Gem> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("Cannot read gems: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Cannot read gems entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(".json") {
            continue;
        }
        let Some(gem) = read_gem_file(&path) else {
            continue;
        };
        // Heal mismatched filename vs id.
        let expected = format!("{}.json", gem.id);
        if name != expected {
            let _ = fs::remove_file(&path);
            write_gem_file(root, &gem)?;
        }
        out.push(gem);
    }
    out.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(out)
}

#[tauri::command(async)]
pub fn list_gems(state: State<'_, VaultState>) -> Result<Vec<Gem>, String> {
    let root = get_root(&state)?;
    scan_gems(&root)
}

#[tauri::command(async)]
pub fn get_gem(id: String, state: State<'_, VaultState>) -> Result<Gem, String> {
    let root = get_root(&state)?;
    let id = id.trim();
    if !is_safe_gem_id(id) {
        return Err("Invalid gem id".into());
    }
    let file = gem_file_path(&root, id);
    read_gem_file(&file).ok_or_else(|| "Gem not found".into())
}

#[tauri::command(async)]
pub fn upsert_gem(
    gem: UpsertGemInput,
    state: State<'_, VaultState>,
) -> Result<Gem, String> {
    let root = get_root(&state)?;
    let (name, instructions, model_id) =
        validate_fields(&gem.name, &gem.instructions, &gem.model_id)?;
    let recent_user_turns = validate_recent_user_turns(gem.recent_user_turns)?;

    let now = now_ms();
    let existing_id = gem
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let saved = if let Some(id) = existing_id {
        if !is_safe_gem_id(id) {
            return Err("Invalid gem id".into());
        }
        let file = gem_file_path(&root, id);
        let prev = read_gem_file(&file).ok_or_else(|| "Gem not found".to_string())?;
        let next = Gem {
            id: prev.id,
            name,
            instructions,
            model_id,
            enable_reasoning: gem.enable_reasoning,
            recent_user_turns,
            created_at: prev.created_at,
            updated_at: now,
        };
        write_gem_file(&root, &next)?;
        next
    } else {
        let id = new_gem_id();
        let next = Gem {
            id,
            name,
            instructions,
            model_id,
            enable_reasoning: gem.enable_reasoning,
            recent_user_turns,
            created_at: now,
            updated_at: now,
        };
        write_gem_file(&root, &next)?;
        next
    };
    Ok(saved)
}

#[tauri::command(async)]
pub fn delete_gem(id: String, state: State<'_, VaultState>) -> Result<(), String> {
    let root = get_root(&state)?;
    let id = id.trim();
    if !is_safe_gem_id(id) {
        return Err("Invalid gem id".into());
    }
    let file = gem_file_path(&root, id);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("Cannot delete gem: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-gems-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn validate_requires_all_fields() {
        assert!(validate_fields("", "inst", "model").is_err());
        assert!(validate_fields("n", "", "model").is_err());
        assert!(validate_fields("n", "inst", "").is_err());
        let ok = validate_fields("  Name  ", "  Do X  ", "  openai/gpt  ").unwrap();
        assert_eq!(ok.0, "Name");
        assert_eq!(ok.1, "Do X");
        assert_eq!(ok.2, "openai/gpt");
    }

    #[test]
    fn write_and_read_gem() {
        let root = temp_vault();
        let gem = Gem {
            id: "g1".into(),
            name: "Tutor".into(),
            instructions: "Help with Spanish.".into(),
            model_id: "openai/gpt-5.6-sol".into(),
            enable_reasoning: false,
            recent_user_turns: Some(5),
            created_at: 1,
            updated_at: 1,
        };
        write_gem_file(&root, &gem).unwrap();
        let loaded = read_gem_file(&gem_file_path(&root, "g1")).unwrap();
        assert_eq!(loaded, gem);
        assert!(!loaded.enable_reasoning);
        let listed = scan_gems(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Tutor");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn enable_reasoning_defaults_true_when_missing() {
        let root = temp_vault();
        fs::create_dir_all(gems_dir(&root)).unwrap();
        fs::write(
            gem_file_path(&root, "g2"),
            r#"{"id":"g2","name":"X","instructions":"Y","modelId":"m","createdAt":1,"updatedAt":1}"#,
        )
        .unwrap();
        let loaded = read_gem_file(&gem_file_path(&root, "g2")).unwrap();
        assert!(loaded.enable_reasoning);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn incomplete_file_skipped() {
        let root = temp_vault();
        fs::create_dir_all(gems_dir(&root)).unwrap();
        fs::write(
            gem_file_path(&root, "bad"),
            r#"{"id":"bad","name":"X","instructions":"","modelId":"m"}"#,
        )
        .unwrap();
        assert!(read_gem_file(&gem_file_path(&root, "bad")).is_none());
        assert!(scan_gems(&root).unwrap().is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
