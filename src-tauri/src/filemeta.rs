//! Per-file vault metadata under `.markspace/filemeta/<sha256(path)>.json`.
//!
//! v1: tags for PDF (and any non-md path). Same “one file per path” pattern as
//! favorites so renames remaps cleanly and git sync collides only per path.

use crate::vault::{ensure_inside, get_root, VaultState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileMetaFile {
    path: String,
    #[serde(default)]
    tags: Vec<String>,
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

fn filemeta_dir(root: &Path) -> PathBuf {
    root.join(".markspace").join("filemeta")
}

fn filemeta_id(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn filemeta_file_path(root: &Path, path: &str) -> PathBuf {
    filemeta_dir(root).join(format!("{}.json", filemeta_id(path)))
}

fn path_exists(root: &Path, rel: &str) -> bool {
    root.join(rel).exists()
}

/// Normalize tag names: trim, strip leading `#`, case-insensitive dedupe.
pub fn normalize_tags(raw: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in raw {
        let mut t = item.trim().to_string();
        if t.starts_with('#') {
            t = t[1..].trim().to_string();
        }
        if t.is_empty() {
            continue;
        }
        let key = t.to_lowercase();
        if seen.insert(key) {
            out.push(t);
        }
    }
    out
}

fn read_meta_file(path: &Path) -> Option<FileMetaFile> {
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let rel = value.get("path")?.as_str()?.trim().replace('\\', "/");
    let rel = rel.trim_matches('/').to_string();
    if rel.is_empty() {
        return None;
    }
    let tags = match value.get("tags") {
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        Some(Value::String(s)) => s
            .split(',')
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .collect(),
        _ => Vec::new(),
    };
    Some(FileMetaFile {
        path: rel,
        tags: normalize_tags(&tags),
    })
}

fn write_meta_file(root: &Path, path: &str, tags: &[String]) -> Result<(), String> {
    let dir = filemeta_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create filemeta dir: {e}"))?;
    let file = filemeta_file_path(root, path);
    let body = serde_json::to_string_pretty(&json!({
        "path": path,
        "tags": tags,
    }))
    .map_err(|e| format!("Cannot serialize filemeta: {e}"))?;
    fs::write(&file, format!("{body}\n")).map_err(|e| format!("Cannot write filemeta: {e}"))
}

fn remove_meta_file(root: &Path, path: &str) -> Result<(), String> {
    let file = filemeta_file_path(root, path);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("Cannot remove filemeta: {e}"))?;
    }
    Ok(())
}

fn scan_meta_markers(root: &Path) -> Result<Vec<(PathBuf, FileMetaFile)>, String> {
    let dir = filemeta_dir(root);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out: Vec<(PathBuf, FileMetaFile)> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("Cannot read filemeta: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Cannot read filemeta entry: {e}"))?;
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
        let Some(meta) = read_meta_file(&path) else {
            let _ = fs::remove_file(&path);
            continue;
        };
        out.push((path, meta));
    }
    Ok(out)
}

/// Load tags for existing vault files from filemeta sidecars.
pub fn load_all_filemeta_tags(root: &Path) -> HashMap<String, Vec<String>> {
    let mut out = HashMap::new();
    let Ok(markers) = scan_meta_markers(root) else {
        return out;
    };
    for (file, meta) in markers {
        let expected = filemeta_file_path(root, &meta.path);
        if file != expected {
            let _ = fs::remove_file(&file);
            if path_exists(root, &meta.path) && !meta.tags.is_empty() {
                let _ = write_meta_file(root, &meta.path, &meta.tags);
            } else {
                continue;
            }
        } else if !path_exists(root, &meta.path) {
            let _ = fs::remove_file(&file);
            continue;
        }
        if meta.tags.is_empty() {
            let _ = remove_meta_file(root, &meta.path);
            continue;
        }
        out.insert(meta.path, meta.tags);
    }
    out
}

pub fn get_tags_for_path(root: &Path, path: &str) -> Result<Vec<String>, String> {
    let rel = normalize_rel(path)?;
    let file = filemeta_file_path(root, &rel);
    if !file.is_file() {
        return Ok(Vec::new());
    }
    Ok(read_meta_file(&file).map(|m| m.tags).unwrap_or_default())
}

pub fn set_tags_for_path(root: &Path, path: &str, tags: &[String]) -> Result<Vec<String>, String> {
    let rel = normalize_rel(path)?;
    if !path_exists(root, &rel) {
        return Err("Path not found".into());
    }
    let tags = normalize_tags(tags);
    if tags.is_empty() {
        remove_meta_file(root, &rel)?;
    } else {
        write_meta_file(root, &rel, &tags)?;
    }
    Ok(tags)
}

/// Remap filemeta after rename/move (`to = Some`) or delete (`to = None`).
pub fn remap_filemeta(root: &Path, from: &str, to: Option<&str>) -> Result<(), String> {
    let from = from.trim().trim_matches('/').replace('\\', "/");
    if from.is_empty() {
        return Ok(());
    }
    let to = to.map(|t| t.trim().trim_matches('/').replace('\\', "/"));

    let markers = match scan_meta_markers(root) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    for (_file, meta) in markers {
        let old = meta.path;
        let next = if old == from {
            to.clone()
        } else if old.starts_with(&format!("{from}/")) {
            to.as_ref()
                .map(|t| format!("{t}{}", &old[from.len()..]))
        } else {
            continue;
        };

        let _ = remove_meta_file(root, &old);
        if let Some(new_path) = next {
            if !new_path.is_empty() && path_exists(root, &new_path) && !meta.tags.is_empty() {
                let _ = write_meta_file(root, &new_path, &meta.tags);
            }
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn get_file_tags(path: String, state: State<'_, VaultState>) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    get_tags_for_path(&root, &path)
}

#[tauri::command(async)]
pub fn set_file_tags(
    path: String,
    tags: Vec<String>,
    state: State<'_, VaultState>,
) -> Result<Vec<String>, String> {
    let root = get_root(&state)?;
    let rel = normalize_rel(&path)?;
    // Ensure path stays inside vault.
    let _ = ensure_inside(&root, Path::new(&rel))?;
    let next = set_tags_for_path(&root, &rel, &tags)?;
    crate::vault::set_tag_index_path(&state, &rel, next.clone());
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-filemeta-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.pdf"), b"%PDF").unwrap();
        fs::create_dir_all(dir.join("docs")).unwrap();
        fs::write(dir.join("docs").join("b.pdf"), b"%PDF").unwrap();
        dir
    }

    #[test]
    fn set_get_clear() {
        let root = temp_vault();
        let tags = set_tags_for_path(&root, "a.pdf", &["Work".into(), "#work".into(), "api".into()])
            .unwrap();
        assert_eq!(tags, vec!["Work".to_string(), "api".to_string()]);
        assert_eq!(get_tags_for_path(&root, "a.pdf").unwrap(), tags);
        let cleared = set_tags_for_path(&root, "a.pdf", &[]).unwrap();
        assert!(cleared.is_empty());
        assert!(!filemeta_file_path(&root, "a.pdf").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remap_rename_and_delete() {
        let root = temp_vault();
        set_tags_for_path(&root, "a.pdf", &["x".into()]).unwrap();
        set_tags_for_path(&root, "docs/b.pdf", &["y".into()]).unwrap();

        fs::rename(root.join("a.pdf"), root.join("renamed.pdf")).unwrap();
        remap_filemeta(&root, "a.pdf", Some("renamed.pdf")).unwrap();

        fs::create_dir_all(root.join("archive")).unwrap();
        fs::rename(root.join("docs/b.pdf"), root.join("archive/b.pdf")).unwrap();
        remap_filemeta(&root, "docs", Some("archive")).unwrap();

        let all = load_all_filemeta_tags(&root);
        assert_eq!(
            all.get("renamed.pdf"),
            Some(&vec!["x".to_string()])
        );
        assert_eq!(
            all.get("archive/b.pdf"),
            Some(&vec!["y".to_string()])
        );

        fs::remove_file(root.join("renamed.pdf")).unwrap();
        remap_filemeta(&root, "renamed.pdf", None).unwrap();
        let all = load_all_filemeta_tags(&root);
        assert!(!all.contains_key("renamed.pdf"));
        assert!(all.contains_key("archive/b.pdf"));
        let _ = fs::remove_dir_all(&root);
    }
}
