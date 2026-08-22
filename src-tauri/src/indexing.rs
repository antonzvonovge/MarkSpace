//! Indexing policy: persisted in app `settings.json` by the frontend (`indexingByVault`).
//! Rust only reads that file when opening a vault, and applies live policy updates.

use crate::vault::{get_root, VaultState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

const MAX_DELAY_SECONDS: u32 = 300;
const DEFAULT_DELAY_SECONDS: u32 = 5;
const STORE_FILE: &str = "settings.json";
const BY_VAULT_KEY: &str = "indexingByVault";

/// How much of the machine the embeddings sidecar may take.
///
/// Applied at spawn time (worker threads and process priority), never live:
/// Candle reads `RAYON_NUM_THREADS` on first inference, and an unprivileged
/// process cannot lower its own `nice` again (`RLIMIT_NICE` defaults to 0).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundPriority {
    /// Single worker thread, heavily deprioritized, pauses while you work.
    Low,
    /// A couple of threads, deprioritized, pauses while you work.
    Balanced,
    /// No limits and no pauses.
    Full,
}

impl Default for BackgroundPriority {
    fn default() -> Self {
        Self::Balanced
    }
}

impl BackgroundPriority {
    /// `Full` keeps indexing through typing and chat streaming.
    pub fn pauses_on_activity(self) -> bool {
        !matches!(self, Self::Full)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingSettings {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_delay")]
    pub delay_seconds: u32,
    #[serde(default)]
    pub background_priority: BackgroundPriority,
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
            background_priority: BackgroundPriority::default(),
        }
    }
}

pub fn normalize(mut doc: IndexingSettings) -> IndexingSettings {
    doc.version = 1;
    doc.delay_seconds = doc.delay_seconds.min(MAX_DELAY_SECONDS);
    doc
}

fn store_path(app_data: &Path) -> PathBuf {
    app_data.join(STORE_FILE)
}

fn legacy_vault_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".markspace").join("indexing.json")
}

fn read_store(app_data: &Path) -> Value {
    let path = store_path(app_data);
    let Ok(raw) = fs::read_to_string(&path) else {
        return Value::Object(Default::default());
    };
    serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default()))
}

fn load_legacy_vault_file(vault_root: &Path) -> Option<IndexingSettings> {
    let path = legacy_vault_path(vault_root);
    if !path.is_file() {
        return None;
    }
    let raw = fs::read_to_string(&path).ok()?;
    if raw.trim().is_empty() {
        return None;
    }
    let doc: IndexingSettings = serde_json::from_str(&raw).ok()?;
    Some(normalize(doc))
}

/// Load policy for a vault absolute path (app settings, then legacy vault file).
pub fn load_for_vault(app_data: &Path, vault_path: &Path) -> IndexingSettings {
    let key = vault_path.to_string_lossy().to_string();
    let store = read_store(app_data);
    if let Some(raw) = store.get(BY_VAULT_KEY).and_then(|v| v.get(&key)) {
        if let Ok(doc) = serde_json::from_value::<IndexingSettings>(raw.clone()) {
            return normalize(doc);
        }
    }
    if let Some(legacy) = load_legacy_vault_file(vault_path) {
        return legacy;
    }
    IndexingSettings::default()
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))
}

#[tauri::command]
pub fn get_indexing_settings(
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<IndexingSettings, String> {
    let root = get_root(&state)?;
    let data = app_data(&app)?;
    Ok(load_for_vault(&data, &root))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetIndexingSettingsArgs {
    pub enabled: bool,
    pub delay_seconds: u32,
    #[serde(default)]
    pub background_priority: BackgroundPriority,
}

/// Apply live policy in the embeddings host. Persistence is done by the frontend
/// (`settings.json` → `indexingByVault`) before this command runs.
#[tauri::command]
pub fn set_indexing_settings(
    state: State<'_, VaultState>,
    args: SetIndexingSettingsArgs,
) -> Result<IndexingSettings, String> {
    let _root = get_root(&state)?;
    let doc = normalize(IndexingSettings {
        version: 1,
        enabled: args.enabled,
        delay_seconds: args.delay_seconds,
        background_priority: args.background_priority,
    });
    crate::embeddings::notify_indexing_policy(
        doc.enabled,
        doc.delay_seconds,
        doc.background_priority,
    );
    Ok(doc)
}

/// Delete legacy `.markspace/indexing.json` after the frontend migrated it.
#[tauri::command]
pub fn clear_legacy_indexing_settings(state: State<'_, VaultState>) -> Result<(), String> {
    let root = get_root(&state)?;
    let path = legacy_vault_path(&root);
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-indexing-{label}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_is_defaults() {
        let app_data = temp_dir("app");
        let vault = temp_dir("vault");
        let doc = load_for_vault(&app_data, &vault);
        assert!(doc.enabled);
        assert_eq!(doc.delay_seconds, DEFAULT_DELAY_SECONDS);
        let _ = fs::remove_dir_all(&app_data);
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn reads_settings_json_by_vault() {
        let app_data = temp_dir("app");
        let vault = temp_dir("vault");
        let key = vault.to_string_lossy().to_string();
        let store = serde_json::json!({
            "indexingByVault": {
                key: { "version": 1, "enabled": false, "delaySeconds": 30 }
            },
            "prefs": { "theme": "dark" }
        });
        fs::write(
            store_path(&app_data),
            serde_json::to_string_pretty(&store).unwrap(),
        )
        .unwrap();
        let loaded = load_for_vault(&app_data, &vault);
        assert!(!loaded.enabled);
        assert_eq!(loaded.delay_seconds, 30);
        let _ = fs::remove_dir_all(&app_data);
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn falls_back_to_legacy_vault_file() {
        let app_data = temp_dir("app");
        let vault = temp_dir("vault");
        let markspace = vault.join(".markspace");
        fs::create_dir_all(&markspace).unwrap();
        fs::write(
            markspace.join("indexing.json"),
            r#"{ "version": 1, "enabled": false, "delaySeconds": 42 }
"#,
        )
        .unwrap();
        let loaded = load_for_vault(&app_data, &vault);
        assert!(!loaded.enabled);
        assert_eq!(loaded.delay_seconds, 42);
        let _ = fs::remove_dir_all(&app_data);
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn clamps_delay() {
        let doc = normalize(IndexingSettings {
            version: 1,
            enabled: true,
            delay_seconds: 9999,
            background_priority: BackgroundPriority::Balanced,
        });
        assert_eq!(doc.delay_seconds, MAX_DELAY_SECONDS);
    }

    #[test]
    fn background_priority_defaults_to_balanced_when_absent() {
        let app_data = temp_dir("app");
        let vault = temp_dir("vault");
        let key = vault.to_string_lossy().to_string();
        let store = serde_json::json!({
            "indexingByVault": {
                key: { "version": 1, "enabled": true, "delaySeconds": 5 }
            }
        });
        fs::write(
            store_path(&app_data),
            serde_json::to_string_pretty(&store).unwrap(),
        )
        .unwrap();
        let loaded = load_for_vault(&app_data, &vault);
        assert_eq!(loaded.background_priority, BackgroundPriority::Balanced);
        assert!(loaded.background_priority.pauses_on_activity());
        let _ = fs::remove_dir_all(&app_data);
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn full_priority_does_not_pause() {
        assert!(!BackgroundPriority::Full.pauses_on_activity());
        assert!(BackgroundPriority::Low.pauses_on_activity());
    }

    #[test]
    fn reads_background_priority_from_store() {
        let app_data = temp_dir("app");
        let vault = temp_dir("vault");
        let key = vault.to_string_lossy().to_string();
        let store = serde_json::json!({
            "indexingByVault": {
                key: {
                    "version": 1,
                    "enabled": true,
                    "delaySeconds": 5,
                    "backgroundPriority": "low"
                }
            }
        });
        fs::write(
            store_path(&app_data),
            serde_json::to_string_pretty(&store).unwrap(),
        )
        .unwrap();
        let loaded = load_for_vault(&app_data, &vault);
        assert_eq!(loaded.background_priority, BackgroundPriority::Low);
        let _ = fs::remove_dir_all(&app_data);
        let _ = fs::remove_dir_all(&vault);
    }
}
