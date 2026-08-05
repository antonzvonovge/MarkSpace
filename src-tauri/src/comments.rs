//! Per-note text comments under `.markspace/comments/<sha256(path)>.json`.
//!
//! Same “one file per path” pattern as filemeta/favorites so renames remap
//! cleanly and git sync collides only per path.

use crate::vault::{ensure_inside, get_root, VaultState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// Structural location inside the Live doc (not written into markdown).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralAnchor {
    pub kind: String,
    #[serde(default)]
    pub start_hash: String,
    #[serde(default)]
    pub start_type: String,
    #[serde(default)]
    pub start_occ: u32,
    #[serde(default)]
    pub start_offset: u32,
    #[serde(default)]
    pub end_hash: String,
    #[serde(default)]
    pub end_type: String,
    #[serde(default)]
    pub end_occ: u32,
    #[serde(default)]
    pub end_offset: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leaf_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leaf_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteComment {
    pub id: String,
    pub quote: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
    /// Optional structural anchor; quote remains UI label + fallback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<StructuralAnchor>,
    pub body: String,
    #[serde(default)]
    pub resolved: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentsFile {
    path: String,
    #[serde(default)]
    comments: Vec<NoteComment>,
}

/// Inbox row: comment plus its note path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentRef {
    pub note_path: String,
    pub comment: NoteComment,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCommentInput {
    #[serde(default)]
    pub id: String,
    pub quote: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
    /// When set, replaces stored structural anchor. When omitted on update, keep existing.
    #[serde(default)]
    pub anchor: Option<StructuralAnchor>,
    pub body: String,
    #[serde(default)]
    pub resolved: Option<bool>,
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

fn comments_dir(root: &Path) -> PathBuf {
    root.join(".markspace").join("comments")
}

fn comments_id(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn comments_file_path(root: &Path, path: &str) -> PathBuf {
    comments_dir(root).join(format!("{}.json", comments_id(path)))
}

fn path_exists(root: &Path, rel: &str) -> bool {
    root.join(rel).exists()
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Compact UTC-ish stamp; UI formats as needed.
    format!("{secs}")
}

fn new_comment_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("c{nanos:x}")
}

fn parse_anchor(value: &Value) -> Option<StructuralAnchor> {
    let kind = value.get("kind")?.as_str()?.trim().to_string();
    if kind.is_empty() {
        return None;
    }
    let u32_field = |key: &str| -> u32 {
        value
            .get(key)
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
            .min(u32::MAX as u64) as u32
    };
    let str_field = |key: &str| -> String {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let opt_str = |key: &str| -> Option<String> {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    };
    Some(StructuralAnchor {
        kind,
        start_hash: str_field("startHash"),
        start_type: str_field("startType"),
        start_occ: u32_field("startOcc"),
        start_offset: u32_field("startOffset"),
        end_hash: str_field("endHash"),
        end_type: str_field("endType"),
        end_occ: u32_field("endOcc"),
        end_offset: u32_field("endOffset"),
        leaf_type: opt_str("leafType"),
        leaf_key: opt_str("leafKey"),
    })
}

fn parse_comment(value: &Value) -> Option<NoteComment> {
    let id = value.get("id")?.as_str()?.trim().to_string();
    if id.is_empty() {
        return None;
    }
    let quote = value
        .get("quote")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let prefix = value
        .get("prefix")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let suffix = value
        .get("suffix")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let anchor = value.get("anchor").and_then(parse_anchor);
    let body = value
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let resolved = value
        .get("resolved")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let created_at = value
        .get("createdAt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let updated_at = value
        .get("updatedAt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Some(NoteComment {
        id,
        quote,
        prefix,
        suffix,
        anchor,
        body,
        resolved,
        created_at,
        updated_at,
    })
}

fn read_comments_file(path: &Path) -> Option<CommentsFile> {
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let rel = value.get("path")?.as_str()?.trim().replace('\\', "/");
    let rel = rel.trim_matches('/').to_string();
    if rel.is_empty() {
        return None;
    }
    let comments = match value.get("comments") {
        Some(Value::Array(arr)) => arr.iter().filter_map(parse_comment).collect(),
        _ => Vec::new(),
    };
    Some(CommentsFile {
        path: rel,
        comments,
    })
}

fn write_comments_file(root: &Path, path: &str, comments: &[NoteComment]) -> Result<(), String> {
    let dir = comments_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create comments dir: {e}"))?;
    let file = comments_file_path(root, path);
    let body = serde_json::to_string_pretty(&json!({
        "path": path,
        "comments": comments,
    }))
    .map_err(|e| format!("Cannot serialize comments: {e}"))?;
    fs::write(&file, format!("{body}\n")).map_err(|e| format!("Cannot write comments: {e}"))
}

fn remove_comments_file(root: &Path, path: &str) -> Result<(), String> {
    let file = comments_file_path(root, path);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("Cannot remove comments: {e}"))?;
    }
    Ok(())
}

fn scan_comment_markers(root: &Path) -> Result<Vec<(PathBuf, CommentsFile)>, String> {
    let dir = comments_dir(root);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out: Vec<(PathBuf, CommentsFile)> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("Cannot read comments: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Cannot read comments entry: {e}"))?;
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
        let Some(meta) = read_comments_file(&path) else {
            let _ = fs::remove_file(&path);
            continue;
        };
        out.push((path, meta));
    }
    Ok(out)
}

fn load_comments_for_path(root: &Path, path: &str) -> Result<Vec<NoteComment>, String> {
    let rel = normalize_rel(path)?;
    let file = comments_file_path(root, &rel);
    if !file.is_file() {
        return Ok(Vec::new());
    }
    Ok(read_comments_file(&file)
        .map(|m| m.comments)
        .unwrap_or_default())
}

fn save_comments_for_path(
    root: &Path,
    path: &str,
    comments: Vec<NoteComment>,
) -> Result<Vec<NoteComment>, String> {
    let rel = normalize_rel(path)?;
    if !path_exists(root, &rel) {
        return Err("Path not found".into());
    }
    if comments.is_empty() {
        remove_comments_file(root, &rel)?;
    } else {
        write_comments_file(root, &rel, &comments)?;
    }
    Ok(comments)
}

/// Remap comments after rename/move (`to = Some`) or delete (`to = None`).
pub fn remap_comments(root: &Path, from: &str, to: Option<&str>) -> Result<(), String> {
    let from = from.trim().trim_matches('/').replace('\\', "/");
    if from.is_empty() {
        return Ok(());
    }
    let to = to.map(|t| t.trim().trim_matches('/').replace('\\', "/"));

    let markers = match scan_comment_markers(root) {
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

        let _ = remove_comments_file(root, &old);
        if let Some(new_path) = next {
            if !new_path.is_empty() && path_exists(root, &new_path) && !meta.comments.is_empty() {
                let _ = write_comments_file(root, &new_path, &meta.comments);
            }
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn list_note_comments(
    path: String,
    state: State<'_, VaultState>,
) -> Result<Vec<NoteComment>, String> {
    let root = get_root(&state)?;
    load_comments_for_path(&root, &path)
}

#[tauri::command(async)]
pub fn list_all_comments(state: State<'_, VaultState>) -> Result<Vec<CommentRef>, String> {
    let root = get_root(&state)?;
    let markers = scan_comment_markers(&root)?;
    let mut out: Vec<CommentRef> = Vec::new();
    for (file, meta) in markers {
        let expected = comments_file_path(&root, &meta.path);
        if file != expected {
            let _ = fs::remove_file(&file);
            if path_exists(&root, &meta.path) && !meta.comments.is_empty() {
                let _ = write_comments_file(&root, &meta.path, &meta.comments);
            } else {
                continue;
            }
        } else if !path_exists(&root, &meta.path) {
            let _ = fs::remove_file(&file);
            continue;
        }
        if meta.comments.is_empty() {
            let _ = remove_comments_file(&root, &meta.path);
            continue;
        }
        for comment in meta.comments {
            out.push(CommentRef {
                note_path: meta.path.clone(),
                comment,
            });
        }
    }
    out.sort_by(|a, b| {
        a.note_path
            .cmp(&b.note_path)
            .then_with(|| a.comment.created_at.cmp(&b.comment.created_at))
    });
    Ok(out)
}

#[tauri::command(async)]
pub fn upsert_note_comment(
    path: String,
    comment: UpsertCommentInput,
    state: State<'_, VaultState>,
) -> Result<NoteComment, String> {
    let root = get_root(&state)?;
    let rel = normalize_rel(&path)?;
    let _ = ensure_inside(&root, Path::new(&rel))?;
    if !path_exists(&root, &rel) {
        return Err("Path not found".into());
    }

    let quote = comment.quote.trim().to_string();
    if quote.is_empty() {
        return Err("Quote required".into());
    }
    let body = comment.body.trim().to_string();
    let prefix = comment.prefix;
    let suffix = comment.suffix;
    let stamp = now_iso();

    let mut comments = load_comments_for_path(&root, &rel)?;
    let id = comment.id.trim().to_string();

    if id.is_empty() {
        let created = NoteComment {
            id: new_comment_id(),
            quote,
            prefix,
            suffix,
            anchor: comment.anchor,
            body,
            resolved: comment.resolved.unwrap_or(false),
            created_at: stamp.clone(),
            updated_at: stamp,
        };
        comments.push(created.clone());
        save_comments_for_path(&root, &rel, comments)?;
        return Ok(created);
    }

    if let Some(existing) = comments.iter_mut().find(|c| c.id == id) {
        existing.quote = quote;
        existing.prefix = prefix;
        existing.suffix = suffix;
        if comment.anchor.is_some() {
            existing.anchor = comment.anchor;
        }
        existing.body = body;
        if let Some(resolved) = comment.resolved {
            existing.resolved = resolved;
        }
        existing.updated_at = stamp;
        let result = existing.clone();
        save_comments_for_path(&root, &rel, comments)?;
        return Ok(result);
    }

    let created = NoteComment {
        id,
        quote,
        prefix,
        suffix,
        anchor: comment.anchor,
        body,
        resolved: comment.resolved.unwrap_or(false),
        created_at: stamp.clone(),
        updated_at: stamp,
    };
    comments.push(created.clone());
    save_comments_for_path(&root, &rel, comments)?;
    Ok(created)
}

#[tauri::command(async)]
pub fn delete_note_comment(
    path: String,
    id: String,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    let root = get_root(&state)?;
    let rel = normalize_rel(&path)?;
    let _ = ensure_inside(&root, Path::new(&rel))?;
    let id = id.trim();
    if id.is_empty() {
        return Err("Comment id required".into());
    }
    let mut comments = load_comments_for_path(&root, &rel)?;
    let before = comments.len();
    comments.retain(|c| c.id != id);
    if comments.len() == before {
        return Ok(());
    }
    save_comments_for_path(&root, &rel, comments)?;
    Ok(())
}

#[tauri::command(async)]
pub fn set_comment_resolved(
    path: String,
    id: String,
    resolved: bool,
    state: State<'_, VaultState>,
) -> Result<NoteComment, String> {
    let root = get_root(&state)?;
    let rel = normalize_rel(&path)?;
    let _ = ensure_inside(&root, Path::new(&rel))?;
    let id = id.trim();
    if id.is_empty() {
        return Err("Comment id required".into());
    }
    let mut comments = load_comments_for_path(&root, &rel)?;
    let stamp = now_iso();
    let Some(existing) = comments.iter_mut().find(|c| c.id == id) else {
        return Err("Comment not found".into());
    };
    existing.resolved = resolved;
    existing.updated_at = stamp;
    let result = existing.clone();
    save_comments_for_path(&root, &rel, comments)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-comments-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(dir.join("Proj").join("sub")).unwrap();
        fs::write(dir.join("Proj").join("a.md"), b"# A\n").unwrap();
        fs::write(dir.join("Proj").join("sub").join("b.md"), b"# B\n").unwrap();
        dir
    }

    #[test]
    fn upsert_list_resolve_delete() {
        let root = temp_vault();
        let created = {
            let mut comments = Vec::new();
            let c = NoteComment {
                id: "c1".into(),
                quote: "hello".into(),
                prefix: "".into(),
                suffix: "".into(),
                anchor: None,
                body: "note".into(),
                resolved: false,
                created_at: "1".into(),
                updated_at: "1".into(),
            };
            comments.push(c.clone());
            save_comments_for_path(&root, "Proj/a.md", comments).unwrap();
            c
        };
        let listed = load_comments_for_path(&root, "Proj/a.md").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);

        let mut comments = listed;
        comments[0].resolved = true;
        save_comments_for_path(&root, "Proj/a.md", comments).unwrap();
        assert!(load_comments_for_path(&root, "Proj/a.md").unwrap()[0].resolved);

        save_comments_for_path(&root, "Proj/a.md", Vec::new()).unwrap();
        assert!(load_comments_for_path(&root, "Proj/a.md").unwrap().is_empty());
        assert!(!comments_file_path(&root, "Proj/a.md").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remap_rename_and_delete() {
        let root = temp_vault();
        write_comments_file(
            &root,
            "Proj/a.md",
            &[NoteComment {
                id: "c1".into(),
                quote: "x".into(),
                prefix: "".into(),
                suffix: "".into(),
                anchor: None,
                body: "y".into(),
                resolved: false,
                created_at: "1".into(),
                updated_at: "1".into(),
            }],
        )
        .unwrap();
        write_comments_file(
            &root,
            "Proj/sub/b.md",
            &[NoteComment {
                id: "c2".into(),
                quote: "a".into(),
                prefix: "".into(),
                suffix: "".into(),
                anchor: None,
                body: "b".into(),
                resolved: false,
                created_at: "1".into(),
                updated_at: "1".into(),
            }],
        )
        .unwrap();

        fs::rename(root.join("Proj/a.md"), root.join("Proj/renamed.md")).unwrap();
        remap_comments(&root, "Proj/a.md", Some("Proj/renamed.md")).unwrap();
        assert_eq!(
            load_comments_for_path(&root, "Proj/renamed.md")
                .unwrap()
                .len(),
            1
        );
        assert!(load_comments_for_path(&root, "Proj/a.md")
            .unwrap()
            .is_empty());

        fs::create_dir_all(root.join("Archive")).unwrap();
        fs::rename(root.join("Proj/sub"), root.join("Archive/sub")).unwrap();
        remap_comments(&root, "Proj/sub", Some("Archive/sub")).unwrap();
        assert_eq!(
            load_comments_for_path(&root, "Archive/sub/b.md")
                .unwrap()
                .len(),
            1
        );

        fs::remove_file(root.join("Proj/renamed.md")).unwrap();
        remap_comments(&root, "Proj/renamed.md", None).unwrap();
        assert!(load_comments_for_path(&root, "Proj/renamed.md")
            .unwrap()
            .is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
