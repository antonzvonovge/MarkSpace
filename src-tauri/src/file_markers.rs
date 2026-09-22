//! File marker catalog stored in `.markspace/file-markers.json` (vault-synced).
//!
//! `markers: null` (or a missing file) means the app default catalog.
//! An explicit empty array is a user-cleared catalog.

use crate::vault::{get_root, VaultState};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

const MAX_MARKERS: usize = 32;
const MAX_LABEL_CHARS: usize = 40;
const MAX_EMOJI_CHARS: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileMarker {
    pub id: String,
    pub emoji: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMarkerSettings {
    #[serde(default = "default_version")]
    pub version: u32,
    /// `None` = use built-in defaults. `Some` = vault catalog (may be empty).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub markers: Option<Vec<FileMarker>>,
}

fn default_version() -> u32 {
    1
}

impl Default for FileMarkerSettings {
    fn default() -> Self {
        Self {
            version: 1,
            markers: None,
        }
    }
}

fn settings_path(root: &Path) -> PathBuf {
    root.join(".markspace").join("file-markers.json")
}

fn is_marker_id(id: &str) -> bool {
    let b = id.as_bytes();
    if b.is_empty() || b.len() > 48 {
        return false;
    }
    let first = b[0];
    if !first.is_ascii_lowercase() {
        return false;
    }
    b.iter()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn normalize_marker(raw: &FileMarker) -> Option<FileMarker> {
    let id = raw.id.trim().to_ascii_lowercase();
    if !is_marker_id(&id) {
        return None;
    }
    let emoji = raw.emoji.trim();
    let emoji_len = emoji.chars().count();
    if emoji.is_empty() || emoji_len > MAX_EMOJI_CHARS {
        return None;
    }
    let label = raw.label.trim();
    if label.is_empty() {
        return None;
    }
    let label: String = label.chars().take(MAX_LABEL_CHARS).collect();
    Some(FileMarker {
        id,
        emoji: emoji.to_string(),
        label,
    })
}

fn normalize_markers(raw: Vec<FileMarker>) -> Vec<FileMarker> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for item in raw {
        let Some(marker) = normalize_marker(&item) else {
            continue;
        };
        if !seen.insert(marker.id.clone()) {
            continue;
        }
        out.push(marker);
        if out.len() >= MAX_MARKERS {
            break;
        }
    }
    out
}

fn load_settings(root: &Path) -> Result<FileMarkerSettings, String> {
    let path = settings_path(root);
    if !path.exists() {
        return Ok(FileMarkerSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(FileMarkerSettings::default());
    }
    let mut doc: FileMarkerSettings =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid file-markers.json: {e}"))?;
    doc.version = 1;
    if let Some(markers) = doc.markers {
        doc.markers = Some(normalize_markers(markers));
    }
    Ok(doc)
}

fn save_settings(root: &Path, doc: &FileMarkerSettings) -> Result<(), String> {
    let markspace = root.join(".markspace");
    fs::create_dir_all(&markspace).map_err(|e| e.to_string())?;
    let path = settings_path(root);
    let body = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    fs::write(&path, format!("{body}\n")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_file_marker_settings(state: State<VaultState>) -> Result<FileMarkerSettings, String> {
    let root = get_root(&state)?;
    load_settings(&root)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFileMarkerSettingsArgs {
    pub markers: Vec<FileMarker>,
}

#[tauri::command]
pub fn set_file_marker_settings(
    state: State<VaultState>,
    args: SetFileMarkerSettingsArgs,
) -> Result<FileMarkerSettings, String> {
    let root = get_root(&state)?;
    let doc = FileMarkerSettings {
        version: 1,
        markers: Some(normalize_markers(args.markers)),
    };
    save_settings(&root, &doc)?;
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-file-markers-{}",
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
        assert!(doc.markers.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn round_trip_custom_catalog() {
        let root = temp_root();
        let doc = FileMarkerSettings {
            version: 1,
            markers: Some(vec![FileMarker {
                id: "Done".into(),
                emoji: " ✅ ".into(),
                label: "  Complete  ".into(),
            }]),
        };
        save_settings(&root, &doc).unwrap();
        let loaded = load_settings(&root).unwrap();
        assert_eq!(
            loaded.markers.unwrap(),
            vec![FileMarker {
                id: "done".into(),
                emoji: "✅".into(),
                label: "Complete".into(),
            }]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn drops_invalid_and_duplicate_ids() {
        let markers = normalize_markers(vec![
            FileMarker {
                id: "ok".into(),
                emoji: "✅".into(),
                label: "Ok".into(),
            },
            FileMarker {
                id: "ok".into(),
                emoji: "x".into(),
                label: "Dup".into(),
            },
            FileMarker {
                id: "1bad".into(),
                emoji: "✅".into(),
                label: "Nope".into(),
            },
        ]);
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].id, "ok");
    }
}
