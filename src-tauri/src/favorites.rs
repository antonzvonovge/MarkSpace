//! Vault favorites stored as one file per path under `.markspace/favorites/`.
//!
//! Concurrent add/remove on different machines collide only when they touch the
//! same favorite path — same “one file per thing” idea as notes themselves.

use crate::vault::VaultState;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

fn normalize_rel(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_matches('/').replace('\\', "/");
    if trimmed.is_empty() {
        return Err("Cannot favorite vault root".into());
    }
    if trimmed.split('/').any(|p| p.is_empty() || p == "." || p == "..") {
        return Err("Invalid favorite path".into());
    }
    for component in Path::new(&trimmed).components() {
        if matches!(component, Component::ParentDir | Component::RootDir) {
            return Err("Invalid favorite path".into());
        }
    }
    Ok(trimmed)
}

fn favorites_dir(root: &Path) -> PathBuf {
    root.join(".markspace").join("favorites")
}

fn favorite_id(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn favorite_file_path(root: &Path, path: &str) -> PathBuf {
    favorites_dir(root).join(format!("{}.json", favorite_id(path)))
}

fn path_exists(root: &Path, rel: &str) -> bool {
    let full = root.join(rel);
    full.exists()
}

fn read_favorite_file(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let rel = value.get("path")?.as_str()?.trim().replace('\\', "/");
    let rel = rel.trim_matches('/').to_string();
    if rel.is_empty() {
        return None;
    }
    Some(rel)
}

fn write_favorite_file(root: &Path, path: &str) -> Result<(), String> {
    let dir = favorites_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create favorites dir: {e}"))?;
    let file = favorite_file_path(root, path);
    let body = serde_json::to_string_pretty(&json!({ "path": path }))
        .map_err(|e| format!("Cannot serialize favorite: {e}"))?;
    fs::write(&file, format!("{body}\n")).map_err(|e| format!("Cannot write favorite: {e}"))
}

fn remove_favorite_file(root: &Path, path: &str) -> Result<(), String> {
    let file = favorite_file_path(root, path);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("Cannot remove favorite: {e}"))?;
    }
    Ok(())
}

/// Read favorite markers without pruning missing vault paths.
fn scan_favorite_markers(root: &Path) -> Result<Vec<(PathBuf, String)>, String> {
    let dir = favorites_dir(root);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out: Vec<(PathBuf, String)> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("Cannot read favorites: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Cannot read favorites entry: {e}"))?;
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
        let Some(rel) = read_favorite_file(&path) else {
            let _ = fs::remove_file(&path);
            continue;
        };
        out.push((path, rel));
    }
    Ok(out)
}

/// List favorite vault-relative paths that still exist. Stale markers are pruned.
pub fn list_favorite_paths(root: &Path) -> Result<Vec<String>, String> {
    let mut paths: Vec<String> = Vec::new();
    for (file, rel) in scan_favorite_markers(root)? {
        let expected = favorite_file_path(root, &rel);
        if file != expected {
            let _ = fs::remove_file(&file);
            if path_exists(root, &rel) {
                let _ = write_favorite_file(root, &rel);
            } else {
                continue;
            }
        } else if !path_exists(root, &rel) {
            let _ = fs::remove_file(&file);
            continue;
        }
        if !paths.iter().any(|p| p == &rel) {
            paths.push(rel);
        }
    }

    paths.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(paths)
}

pub fn add_favorite_path(root: &Path, path: &str) -> Result<Vec<String>, String> {
    let rel = normalize_rel(path)?;
    if !path_exists(root, &rel) {
        return Err("Path not found".into());
    }
    write_favorite_file(root, &rel)?;
    list_favorite_paths(root)
}

pub fn remove_favorite_path(root: &Path, path: &str) -> Result<Vec<String>, String> {
    let rel = normalize_rel(path)?;
    remove_favorite_file(root, &rel)?;
    list_favorite_paths(root)
}

/// Remap favorites after rename/move (`to = Some`) or delete (`to = None`).
///
/// Must run after the filesystem rename/delete. Scans markers without pruning so
/// favorites for the old path are not wiped before remapping.
pub fn remap_favorites(root: &Path, from: &str, to: Option<&str>) -> Result<(), String> {
    let from = from.trim().trim_matches('/').replace('\\', "/");
    if from.is_empty() {
        return Ok(());
    }
    let to = to.map(|t| t.trim().trim_matches('/').replace('\\', "/"));

    let markers = match scan_favorite_markers(root) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    for (_file, old) in markers {
        let next = if old == from {
            to.clone()
        } else if old.starts_with(&format!("{from}/")) {
            to.as_ref()
                .map(|t| format!("{t}{}", &old[from.len()..]))
        } else {
            continue;
        };

        let _ = remove_favorite_file(root, &old);
        if let Some(new_path) = next {
            if !new_path.is_empty() && path_exists(root, &new_path) {
                let _ = write_favorite_file(root, &new_path);
            }
        }
    }
    Ok(())
}

fn get_root(state: &VaultState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "Vault state lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No vault open".to_string())
}

#[tauri::command(async)]
pub fn list_favorites(state: State<VaultState>) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    list_favorite_paths(&root)
}

#[tauri::command(async)]
pub fn add_favorite(path: String, state: State<VaultState>) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    add_favorite_path(&root, &path)
}

#[tauri::command(async)]
pub fn remove_favorite(path: String, state: State<VaultState>) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    remove_favorite_path(&root, &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-fav-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.md"), "# a\n").unwrap();
        fs::create_dir_all(dir.join("proj")).unwrap();
        fs::write(dir.join("proj").join("b.md"), "# b\n").unwrap();
        dir
    }

    #[test]
    fn add_list_remove() {
        let root = temp_vault();
        let paths = add_favorite_path(&root, "a.md").unwrap();
        assert_eq!(paths, vec!["a.md".to_string()]);
        let paths = add_favorite_path(&root, "proj").unwrap();
        assert_eq!(paths, vec!["a.md".to_string(), "proj".to_string()]);
        let paths = remove_favorite_path(&root, "a.md").unwrap();
        assert_eq!(paths, vec!["proj".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn concurrent_adds_are_separate_files() {
        let root = temp_vault();
        add_favorite_path(&root, "a.md").unwrap();
        add_favorite_path(&root, "proj/b.md").unwrap();
        let dir = favorites_dir(&root);
        let count = fs::read_dir(&dir).unwrap().count();
        assert_eq!(count, 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remap_rename_and_delete() {
        let root = temp_vault();
        add_favorite_path(&root, "a.md").unwrap();
        add_favorite_path(&root, "proj/b.md").unwrap();

        // Simulate rename on disk, then remap favorites.
        fs::rename(root.join("a.md"), root.join("renamed.md")).unwrap();
        remap_favorites(&root, "a.md", Some("renamed.md")).unwrap();

        fs::create_dir_all(root.join("work")).unwrap();
        fs::rename(root.join("proj/b.md"), root.join("work/b.md")).unwrap();
        remap_favorites(&root, "proj", Some("work")).unwrap();

        let listed = list_favorite_paths(&root).unwrap();
        assert_eq!(
            listed,
            vec!["renamed.md".to_string(), "work/b.md".to_string()]
        );

        fs::remove_file(root.join("renamed.md")).unwrap();
        remap_favorites(&root, "renamed.md", None).unwrap();
        let listed = list_favorite_paths(&root).unwrap();
        assert_eq!(listed, vec!["work/b.md".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_root() {
        let root = temp_vault();
        assert!(add_favorite_path(&root, "").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
