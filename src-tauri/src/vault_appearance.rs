//! Vault appearance stored in `.markspace/appearance.json` (vault-synced).
//!
//! Missing file means the default Wildberries accent.

use crate::vault::{get_root, VaultState};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

const DEFAULT_ACCENT: &str = "#cb11ab";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultAppearanceFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_accent")]
    pub accent_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultAppearance {
    pub version: u32,
    pub accent_color: String,
    /// True when `.markspace/appearance.json` exists on disk.
    pub persisted: bool,
}

fn default_version() -> u32 {
    1
}

fn default_accent() -> String {
    DEFAULT_ACCENT.to_string()
}

fn appearance_path(root: &Path) -> PathBuf {
    root.join(".markspace").join("appearance.json")
}

fn normalize_hex(raw: &str) -> String {
    let s = raw.trim().trim_start_matches('#').to_ascii_lowercase();
    if s.len() == 6 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        return format!("#{s}");
    }
    if s.len() == 3 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        let mut chars = s.chars();
        let a = chars.next().unwrap();
        let b = chars.next().unwrap();
        let c = chars.next().unwrap();
        return format!("#{a}{a}{b}{b}{c}{c}");
    }
    DEFAULT_ACCENT.to_string()
}

fn load_settings(root: &Path) -> Result<VaultAppearance, String> {
    let path = appearance_path(root);
    if !path.exists() {
        return Ok(VaultAppearance {
            version: 1,
            accent_color: DEFAULT_ACCENT.to_string(),
            persisted: false,
        });
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(VaultAppearance {
            version: 1,
            accent_color: DEFAULT_ACCENT.to_string(),
            persisted: true,
        });
    }
    let doc: VaultAppearanceFile =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid appearance.json: {e}"))?;
    Ok(VaultAppearance {
        version: 1,
        accent_color: normalize_hex(&doc.accent_color),
        persisted: true,
    })
}

fn save_settings(root: &Path, accent_color: &str) -> Result<VaultAppearance, String> {
    let markspace = root.join(".markspace");
    std::fs::create_dir_all(&markspace).map_err(|e| e.to_string())?;
    let hex = normalize_hex(accent_color);
    let doc = VaultAppearanceFile {
        version: 1,
        accent_color: hex.clone(),
    };
    let path = appearance_path(root);
    let body = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("{body}\n")).map_err(|e| e.to_string())?;
    Ok(VaultAppearance {
        version: 1,
        accent_color: hex,
        persisted: true,
    })
}

#[tauri::command]
pub fn get_vault_appearance(state: State<VaultState>) -> Result<VaultAppearance, String> {
    let root = get_root(&state)?;
    load_settings(&root)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVaultAppearanceArgs {
    pub accent_color: String,
}

#[tauri::command]
pub fn set_vault_appearance(
    state: State<VaultState>,
    args: SetVaultAppearanceArgs,
) -> Result<VaultAppearance, String> {
    let root = get_root(&state)?;
    save_settings(&root, &args.accent_color)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-appearance-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_is_default() {
        let root = temp_root();
        let doc = load_settings(&root).unwrap();
        assert!(!doc.persisted);
        assert_eq!(doc.accent_color, DEFAULT_ACCENT);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn round_trip_hex() {
        let root = temp_root();
        let saved = save_settings(&root, "#3F51B5").unwrap();
        assert!(saved.persisted);
        assert_eq!(saved.accent_color, "#3f51b5");
        let loaded = load_settings(&root).unwrap();
        assert_eq!(loaded.accent_color, "#3f51b5");
        let _ = std::fs::remove_dir_all(&root);
    }
}
