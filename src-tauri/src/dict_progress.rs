//! Per-project dictionary practice progress under `.markspace/dict-progress/`.
//!
//! Stores correct-answer counts keyed by vault-relative `.mddict` path and word.
//! The known flag itself lives in the `.mddict` file; this sidecar only tracks
//! progress toward the known threshold.

use crate::vault::VaultState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictEntryProgress {
    pub correct_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictProgressDoc {
    pub project_path: String,
    /// dictPath -> word -> progress
    pub entries: HashMap<String, HashMap<String, DictEntryProgress>>,
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

fn normalize_rel(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_matches('/').replace('\\', "/");
    if trimmed.is_empty() {
        return Err("Path required".into());
    }
    if trimmed.split('/').any(|p| p.is_empty() || p == "." || p == "..") {
        return Err("Invalid path".into());
    }
    for component in Path::new(&trimmed).components() {
        if matches!(component, Component::ParentDir | Component::RootDir) {
            return Err("Invalid path".into());
        }
    }
    Ok(trimmed)
}

fn progress_dir(root: &Path) -> PathBuf {
    root.join(".markspace").join("dict-progress")
}

fn progress_id(project_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project_path.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn progress_file_path(root: &Path, project_path: &str) -> PathBuf {
    progress_dir(root).join(format!("{}.json", progress_id(project_path)))
}

fn empty_doc(project_path: &str) -> DictProgressDoc {
    DictProgressDoc {
        project_path: project_path.to_string(),
        entries: HashMap::new(),
    }
}

fn read_doc(root: &Path, project_path: &str) -> DictProgressDoc {
    let file = progress_file_path(root, project_path);
    let Ok(raw) = fs::read_to_string(&file) else {
        return empty_doc(project_path);
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return empty_doc(project_path);
    };
    let mut entries: HashMap<String, HashMap<String, DictEntryProgress>> = HashMap::new();
    if let Some(map) = value.get("entries").and_then(|v| v.as_object()) {
        for (dict_path, words_val) in map {
            let Ok(dict_rel) = normalize_rel(dict_path) else {
                continue;
            };
            let mut words: HashMap<String, DictEntryProgress> = HashMap::new();
            if let Some(word_map) = words_val.as_object() {
                for (word, prog_val) in word_map {
                    let w = word.trim();
                    if w.is_empty() {
                        continue;
                    }
                    let count = prog_val
                        .get("correctCount")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32;
                    words.insert(
                        w.to_string(),
                        DictEntryProgress {
                            correct_count: count,
                        },
                    );
                }
            }
            if !words.is_empty() {
                entries.insert(dict_rel, words);
            }
        }
    }
    DictProgressDoc {
        project_path: project_path.to_string(),
        entries,
    }
}

fn write_doc(root: &Path, doc: &DictProgressDoc) -> Result<(), String> {
    let dir = progress_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create dict-progress dir: {e}"))?;
    let file = progress_file_path(root, &doc.project_path);

    let mut entries_obj = Map::new();
    for (dict_path, words) in &doc.entries {
        let mut word_obj = Map::new();
        for (word, prog) in words {
            word_obj.insert(
                word.clone(),
                json!({ "correctCount": prog.correct_count }),
            );
        }
        if !word_obj.is_empty() {
            entries_obj.insert(dict_path.clone(), Value::Object(word_obj));
        }
    }

    if entries_obj.is_empty() {
        if file.exists() {
            fs::remove_file(&file).map_err(|e| format!("Cannot remove empty progress file: {e}"))?;
        }
        return Ok(());
    }

    let body = serde_json::to_string_pretty(&json!({
        "projectPath": doc.project_path,
        "entries": Value::Object(entries_obj),
    }))
    .map_err(|e| format!("Cannot serialize dict progress: {e}"))?;
    fs::write(&file, body).map_err(|e| format!("Cannot write dict progress: {e}"))?;
    Ok(())
}

fn find_word_key(words: &HashMap<String, DictEntryProgress>, word: &str) -> Option<String> {
    let target = word.trim().to_lowercase();
    words
        .keys()
        .find(|k| k.trim().to_lowercase() == target)
        .cloned()
}

/// Remap dict-path keys inside progress files after rename/move/delete.
pub fn remap_dict_progress(root: &Path, from: &str, to: Option<&str>) -> Result<(), String> {
    let from_rel = normalize_rel(from)?;
    let to_rel = match to {
        Some(t) => Some(normalize_rel(t)?),
        None => None,
    };

    let dir = progress_dir(root);
    if !dir.is_dir() {
        return Ok(());
    }

    let entries = fs::read_dir(&dir).map_err(|e| format!("Cannot read dict-progress: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let Some(entries_map) = value.get_mut("entries").and_then(|v| v.as_object_mut()) else {
            continue;
        };

        let mut changed = false;
        let keys: Vec<String> = entries_map.keys().cloned().collect();
        for key in keys {
            let matches_exact = key == from_rel;
            let matches_prefix = key.starts_with(&format!("{from_rel}/"));
            if !matches_exact && !matches_prefix {
                continue;
            }
            let Some(val) = entries_map.remove(&key) else {
                continue;
            };
            changed = true;
            if let Some(to_base) = &to_rel {
                let new_key = if matches_exact {
                    to_base.clone()
                } else {
                    format!("{to_base}{}", &key[from_rel.len()..])
                };
                entries_map.insert(new_key, val);
            }
        }

        if !changed {
            continue;
        }

        if entries_map.is_empty() {
            let _ = fs::remove_file(&path);
        } else {
            let body = serde_json::to_string_pretty(&value)
                .map_err(|e| format!("Cannot serialize remapped progress: {e}"))?;
            fs::write(&path, body).map_err(|e| format!("Cannot write remapped progress: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_dict_progress(
    state: State<'_, VaultState>,
    project_path: String,
) -> Result<DictProgressDoc, String> {
    let root = crate::vault::get_root(&state)?;
    let project = normalize_project_path(&project_path)?;
    Ok(read_doc(&root, &project))
}

#[tauri::command]
pub fn set_dict_entry_progress(
    state: State<'_, VaultState>,
    project_path: String,
    dict_path: String,
    word: String,
    correct_count: u32,
) -> Result<DictEntryProgress, String> {
    let root = crate::vault::get_root(&state)?;
    let project = normalize_project_path(&project_path)?;
    let dict_rel = normalize_rel(&dict_path)?;
    let word_trim = word.trim().to_string();
    if word_trim.is_empty() {
        return Err("Word required".into());
    }
    if !dict_rel.to_lowercase().ends_with(".mddict") {
        return Err("Expected a .mddict path".into());
    }

    let mut doc = read_doc(&root, &project);
    let dict_key = dict_rel.clone();
    {
        let words = doc.entries.entry(dict_rel).or_default();
        if let Some(existing_key) = find_word_key(words, &word_trim) {
            if correct_count == 0 {
                words.remove(&existing_key);
            } else {
                words.insert(
                    existing_key,
                    DictEntryProgress {
                        correct_count,
                    },
                );
            }
        } else if correct_count > 0 {
            words.insert(
                word_trim.clone(),
                DictEntryProgress {
                    correct_count,
                },
            );
        }
    }
    if doc
        .entries
        .get(&dict_key)
        .map(|w| w.is_empty())
        .unwrap_or(false)
    {
        doc.entries.remove(&dict_key);
    }
    write_doc(&root, &doc)?;
    Ok(DictEntryProgress {
        correct_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-dict-progress-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trips_progress() {
        let root = temp_root("round");
        let mut doc = empty_doc("German");
        doc.entries.insert(
            "German/verbs.mddict".into(),
            HashMap::from([(
                "sprechen".into(),
                DictEntryProgress { correct_count: 3 },
            )]),
        );
        write_doc(&root, &doc).unwrap();
        let loaded = read_doc(&root, "German");
        assert_eq!(
            loaded.entries["German/verbs.mddict"]["sprechen"].correct_count,
            3
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remaps_dict_path() {
        let root = temp_root("remap");
        let mut doc = empty_doc("German");
        doc.entries.insert(
            "German/old.mddict".into(),
            HashMap::from([(
                "Haus".into(),
                DictEntryProgress { correct_count: 2 },
            )]),
        );
        write_doc(&root, &doc).unwrap();
        remap_dict_progress(&root, "German/old.mddict", Some("German/new.mddict")).unwrap();
        let loaded = read_doc(&root, "German");
        assert!(loaded.entries.get("German/old.mddict").is_none());
        assert_eq!(
            loaded.entries["German/new.mddict"]["Haus"].correct_count,
            2
        );
        let _ = fs::remove_dir_all(&root);
    }
}
