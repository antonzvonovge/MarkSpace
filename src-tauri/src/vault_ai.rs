//! Vault AI model defaults stored in `.markspace/ai.json` (vault-synced).
//!
//! Missing file / empty ids mean the app falls back to machine AI settings
//! (chat) and the built-in worker default. Keys never live here.

use crate::vault::{get_root, VaultState};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

const MAX_MODEL_ID_CHARS: usize = 160;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultAiSettings {
    #[serde(default = "default_version")]
    pub version: u32,
    /// `None` = inherit app default chat model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_model_id: Option<String>,
    /// `None` = inherit built-in worker default (`openai/gpt-4.1-mini`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker_model_id: Option<String>,
}

fn default_version() -> u32 {
    1
}

impl Default for VaultAiSettings {
    fn default() -> Self {
        Self {
            version: 1,
            chat_model_id: None,
            worker_model_id: None,
        }
    }
}

fn vault_ai_path(root: &Path) -> PathBuf {
    root.join(".markspace").join("ai.json")
}

fn normalize_model_id(raw: Option<&str>) -> Option<String> {
    let id = raw?.trim();
    if id.is_empty() || id.len() > MAX_MODEL_ID_CHARS {
        return None;
    }
    if id.contains('/')
        && id
            .chars()
            .all(|c| c.is_ascii_graphic() && c != '<' && c != '>' && c != '"')
    {
        return Some(id.to_string());
    }
    None
}

fn normalize_doc(mut doc: VaultAiSettings) -> VaultAiSettings {
    doc.version = 1;
    doc.chat_model_id = normalize_model_id(doc.chat_model_id.as_deref());
    doc.worker_model_id = normalize_model_id(doc.worker_model_id.as_deref());
    doc
}

fn load_settings(root: &Path) -> Result<VaultAiSettings, String> {
    let path = vault_ai_path(root);
    if !path.exists() {
        return Ok(VaultAiSettings::default());
    }
    let raw = fs_read(&path)?;
    if raw.trim().is_empty() {
        return Ok(VaultAiSettings::default());
    }
    let doc: VaultAiSettings =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid ai.json: {e}"))?;
    Ok(normalize_doc(doc))
}

fn fs_read(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

fn save_settings(root: &Path, doc: &VaultAiSettings) -> Result<(), String> {
    let markspace = root.join(".markspace");
    std::fs::create_dir_all(&markspace).map_err(|e| e.to_string())?;
    let path = vault_ai_path(root);
    let body = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("{body}\n")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_vault_ai_settings(state: State<VaultState>) -> Result<VaultAiSettings, String> {
    let root = get_root(&state)?;
    load_settings(&root)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVaultAiSettingsArgs {
    pub chat_model_id: Option<String>,
    pub worker_model_id: Option<String>,
}

#[tauri::command]
pub fn set_vault_ai_settings(
    state: State<VaultState>,
    args: SetVaultAiSettingsArgs,
) -> Result<VaultAiSettings, String> {
    let root = get_root(&state)?;
    let doc = normalize_doc(VaultAiSettings {
        version: 1,
        chat_model_id: args.chat_model_id,
        worker_model_id: args.worker_model_id,
    });
    save_settings(&root, &doc)?;
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-vault-ai-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_is_defaults() {
        let root = temp_root();
        let doc = load_settings(&root).unwrap();
        assert!(doc.chat_model_id.is_none());
        assert!(doc.worker_model_id.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn round_trip_model_ids() {
        let root = temp_root();
        let doc = VaultAiSettings {
            version: 1,
            chat_model_id: Some(" openai/gpt-5.6-sol ".into()),
            worker_model_id: Some("openai/gpt-4.1-mini".into()),
        };
        save_settings(&root, &normalize_doc(doc)).unwrap();
        let loaded = load_settings(&root).unwrap();
        assert_eq!(
            loaded.chat_model_id.as_deref(),
            Some("openai/gpt-5.6-sol")
        );
        assert_eq!(
            loaded.worker_model_id.as_deref(),
            Some("openai/gpt-4.1-mini")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn drops_invalid_ids() {
        assert!(normalize_model_id(Some("")).is_none());
        assert!(normalize_model_id(Some("gpt-4.1-mini")).is_none());
        assert!(normalize_model_id(Some("openai/gpt-4.1-mini")).is_some());
        assert!(normalize_model_id(Some("openai/foo<script>")).is_none());
    }
}
