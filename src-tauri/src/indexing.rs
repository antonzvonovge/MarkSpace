//! Vault indexing policy stored in `.markspace/indexing.json`.

use crate::vault::{get_root, VaultState};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

const MAX_DELAY_SECONDS: u32 = 300;
const DEFAULT_DELAY_SECONDS: u32 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingSettings {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_delay")]
    pub delay_seconds: u32,
}

fn default_version() -> u32 {
    1
}

fn default_enabled() -> bool {
    true
}

fn default_delay() -> u32 {
    DEFAULT_DELAY_SECONDS
}

impl Default for IndexingSettings {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: true,
            delay_seconds: DEFAULT_DELAY_SECONDS,
        }
    }
}

fn indexing_path(root: &Path) -> PathBuf {
    root.join(".markspace").join("indexing.json")
}

fn normalize(mut doc: IndexingSettings) -> IndexingSettings {
    doc.version = 1;
    doc.delay_seconds = doc.delay_seconds.min(MAX_DELAY_SECONDS);
    doc
}

pub fn load_settings(root: &Path) -> Result<IndexingSettings, String> {
    let path = indexing_path(root);
    if !path.exists() {
        return Ok(IndexingSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(IndexingSettings::default());
    }
    let doc: IndexingSettings =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid indexing.json: {e}"))?;
    Ok(normalize(doc))
}

fn save_settings(root: &Path, doc: &IndexingSettings) -> Result<(), String> {
    let markspace = root.join(".markspace");
    fs::create_dir_all(&markspace).map_err(|e| e.to_string())?;
    let path = indexing_path(root);
    let body = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    fs::write(&path, format!("{body}\n")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_indexing_settings(state: State<'_, VaultState>) -> Result<IndexingSettings, String> {
    let root = get_root(&state)?;
    load_settings(&root)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetIndexingSettingsArgs {
    pub enabled: bool,
    pub delay_seconds: u32,
}

#[tauri::command]
pub fn set_indexing_settings(
    state: State<'_, VaultState>,
    args: SetIndexingSettingsArgs,
) -> Result<IndexingSettings, String> {
    let root = get_root(&state)?;
    let doc = normalize(IndexingSettings {
        version: 1,
        enabled: args.enabled,
        delay_seconds: args.delay_seconds,
    });
    save_settings(&root, &doc)?;
    crate::embeddings::notify_indexing_policy(doc.enabled, doc.delay_seconds);
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-indexing-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_is_defaults() {
        let root = temp_root();
        let doc = load_settings(&root).unwrap();
        assert!(doc.enabled);
        assert_eq!(doc.delay_seconds, DEFAULT_DELAY_SECONDS);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn round_trip() {
        let root = temp_root();
        let doc = IndexingSettings {
            version: 1,
            enabled: false,
            delay_seconds: 30,
        };
        save_settings(&root, &doc).unwrap();
        let loaded = load_settings(&root).unwrap();
        assert!(!loaded.enabled);
        assert_eq!(loaded.delay_seconds, 30);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn clamps_delay() {
        let doc = normalize(IndexingSettings {
            version: 1,
            enabled: true,
            delay_seconds: 9999,
        });
        assert_eq!(doc.delay_seconds, MAX_DELAY_SECONDS);
    }
}
