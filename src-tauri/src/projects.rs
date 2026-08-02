//! Project properties stored as one file per project under `.markspace/projects/`.
//!
//! A "project" is a first-level folder under the vault root. Concurrent edits on
//! different machines collide only when they touch the same project path.

use crate::vault::VaultState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

/// Known project types (`""` = unset).
const PROJECT_TYPE_KNOWLEDGE_BASE: &str = "knowledgeBase";
const PROJECT_TYPE_LANGUAGE_LEARNING: &str = "languageLearning";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProperties {
    pub path: String,
    /// Free-form description: what the project is about.
    #[serde(default)]
    pub about: String,
    /// `""` | `knowledgeBase` | `languageLearning`.
    #[serde(default)]
    pub project_type: String,
    /// ISO 639-1 code when `project_type` is `languageLearning`; otherwise empty.
    #[serde(default)]
    pub learning_language: String,
}

fn normalize_project_type(raw: &str) -> String {
    match raw.trim() {
        PROJECT_TYPE_KNOWLEDGE_BASE => PROJECT_TYPE_KNOWLEDGE_BASE.to_string(),
        PROJECT_TYPE_LANGUAGE_LEARNING => PROJECT_TYPE_LANGUAGE_LEARNING.to_string(),
        _ => String::new(),
    }
}

fn normalize_learning_language(project_type: &str, raw: &str) -> String {
    if project_type != PROJECT_TYPE_LANGUAGE_LEARNING {
        return String::new();
    }
    raw.trim().to_string()
}

fn normalize_project_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_matches('/').replace('\\', "/");
    if trimmed.is_empty() {
        return Err("Cannot set properties on vault root".into());
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

fn is_project_path(path: &str) -> bool {
    let trimmed = path.trim().trim_matches('/').replace('\\', "/");
    !trimmed.is_empty() && !trimmed.contains('/')
}

fn projects_dir(root: &Path) -> PathBuf {
    root.join(".markspace").join("projects")
}

fn project_id(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn project_file_path(root: &Path, path: &str) -> PathBuf {
    projects_dir(root).join(format!("{}.json", project_id(path)))
}

fn path_exists_dir(root: &Path, rel: &str) -> bool {
    let full = root.join(rel);
    full.is_dir()
}

fn read_project_file(path: &Path) -> Option<ProjectProperties> {
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let rel = value.get("path")?.as_str()?.trim().replace('\\', "/");
    let rel = rel.trim_matches('/').to_string();
    if !is_project_path(&rel) {
        return None;
    }
    let about = value
        .get("about")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let project_type = normalize_project_type(
        value
            .get("projectType")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
    );
    let learning_language = normalize_learning_language(
        &project_type,
        value
            .get("learningLanguage")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
    );
    Some(ProjectProperties {
        path: rel,
        about,
        project_type,
        learning_language,
    })
}

fn write_project_file(root: &Path, props: &ProjectProperties) -> Result<(), String> {
    let dir = projects_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create projects dir: {e}"))?;
    let file = project_file_path(root, &props.path);
    let body = serde_json::to_string_pretty(&json!({
        "path": props.path,
        "about": props.about,
        "projectType": props.project_type,
        "learningLanguage": props.learning_language,
    }))
    .map_err(|e| format!("Cannot serialize project properties: {e}"))?;
    fs::write(&file, format!("{body}\n"))
        .map_err(|e| format!("Cannot write project properties: {e}"))
}

fn remove_project_file(root: &Path, path: &str) -> Result<(), String> {
    let file = project_file_path(root, path);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("Cannot remove project properties: {e}"))?;
    }
    Ok(())
}

fn scan_project_markers(root: &Path) -> Result<Vec<(PathBuf, ProjectProperties)>, String> {
    let dir = projects_dir(root);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out: Vec<(PathBuf, ProjectProperties)> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("Cannot read projects: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Cannot read projects entry: {e}"))?;
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
        let Some(props) = read_project_file(&path) else {
            let _ = fs::remove_file(&path);
            continue;
        };
        out.push((path, props));
    }
    Ok(out)
}

fn get_root(state: &VaultState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "Vault state lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No vault open".to_string())
}

fn empty_props(path: String) -> ProjectProperties {
    ProjectProperties {
        path,
        about: String::new(),
        project_type: String::new(),
        learning_language: String::new(),
    }
}

/// Load properties for a project folder. Missing file → empty defaults.
#[tauri::command(async)]
pub fn get_project_properties(
    path: String,
    state: State<VaultState>,
) -> Result<ProjectProperties, String> {
    let root = get_root(&state)?;
    let rel = normalize_project_path(&path)?;
    if !path_exists_dir(&root, &rel) {
        return Err("Project not found".into());
    }

    let file = project_file_path(&root, &rel);
    if let Some(props) = read_project_file(&file) {
        if props.path == rel {
            return Ok(props);
        }
    }

    // Heal mismatched hash filename if a marker for this path exists elsewhere.
    for (marker, props) in scan_project_markers(&root)? {
        if props.path == rel {
            let _ = fs::remove_file(&marker);
            let healed = ProjectProperties {
                path: rel.clone(),
                about: props.about,
                project_type: props.project_type,
                learning_language: props.learning_language,
            };
            write_project_file(&root, &healed)?;
            return Ok(healed);
        }
    }

    Ok(empty_props(rel))
}

/// List all stored project property markers for the open vault.
#[tauri::command(async)]
pub fn list_project_properties(
    state: State<VaultState>,
) -> Result<Vec<ProjectProperties>, String> {
    let root = get_root(&state)?;
    let mut out: Vec<ProjectProperties> = Vec::new();
    for (marker, props) in scan_project_markers(&root)? {
        if !path_exists_dir(&root, &props.path) {
            let _ = fs::remove_file(&marker);
            continue;
        }
        // Heal mismatched hash filename.
        let expected = project_file_path(&root, &props.path);
        if marker != expected {
            let _ = fs::remove_file(&marker);
            let _ = write_project_file(&root, &props);
        }
        out.push(props);
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

#[tauri::command(async)]
pub fn set_project_properties(
    path: String,
    about: String,
    project_type: String,
    learning_language: String,
    state: State<VaultState>,
) -> Result<ProjectProperties, String> {
    let root = get_root(&state)?;
    let rel = normalize_project_path(&path)?;
    if !path_exists_dir(&root, &rel) {
        return Err("Project not found".into());
    }

    let project_type = normalize_project_type(&project_type);
    let learning_language = normalize_learning_language(&project_type, &learning_language);
    let props = ProjectProperties {
        path: rel,
        about: about.trim().to_string(),
        project_type,
        learning_language,
    };

    // Drop any stale markers for this path (wrong hash filename).
    for (marker, existing) in scan_project_markers(&root)? {
        if existing.path == props.path && marker != project_file_path(&root, &props.path) {
            let _ = fs::remove_file(&marker);
        }
    }

    write_project_file(&root, &props)?;
    Ok(props)
}

/// Remap project properties after rename/move (`to = Some`) or delete (`to = None`).
///
/// Only first-level folder paths are projects; moving a project into a nested
/// location drops its properties.
pub fn remap_project_properties(root: &Path, from: &str, to: Option<&str>) -> Result<(), String> {
    let from = from.trim().trim_matches('/').replace('\\', "/");
    if !is_project_path(&from) {
        return Ok(());
    }
    let to = to.map(|t| t.trim().trim_matches('/').replace('\\', "/"));

    let markers = match scan_project_markers(root) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    for (_file, props) in markers {
        if props.path != from {
            continue;
        }
        let _ = remove_project_file(root, &from);
        if let Some(ref new_path) = to {
            if is_project_path(new_path) && path_exists_dir(root, new_path) {
                let next = ProjectProperties {
                    path: new_path.clone(),
                    about: props.about,
                    project_type: props.project_type,
                    learning_language: props.learning_language,
                };
                let _ = write_project_file(root, &next);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-proj-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(dir.join("Alpha")).unwrap();
        fs::create_dir_all(dir.join("Beta")).unwrap();
        fs::create_dir_all(dir.join("nested").join("deep")).unwrap();
        dir
    }

    #[test]
    fn write_and_read_about() {
        let root = temp_vault();
        let props = ProjectProperties {
            path: "Alpha".into(),
            about: "Notes about Alpha".into(),
            project_type: String::new(),
            learning_language: String::new(),
        };
        write_project_file(&root, &props).unwrap();
        let file = project_file_path(&root, "Alpha");
        let loaded = read_project_file(&file).unwrap();
        assert_eq!(loaded.about, "Notes about Alpha");
        assert_eq!(loaded.project_type, "");
        assert_eq!(loaded.learning_language, "");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_and_read_language_learning() {
        let root = temp_vault();
        let props = ProjectProperties {
            path: "Alpha".into(),
            about: "Spanish notes".into(),
            project_type: PROJECT_TYPE_LANGUAGE_LEARNING.into(),
            learning_language: "es".into(),
        };
        write_project_file(&root, &props).unwrap();
        let loaded = read_project_file(&project_file_path(&root, "Alpha")).unwrap();
        assert_eq!(loaded.project_type, PROJECT_TYPE_LANGUAGE_LEARNING);
        assert_eq!(loaded.learning_language, "es");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn learning_language_cleared_when_not_language_learning() {
        let root = temp_vault();
        // Simulate a hand-edited file that still has a language with another type.
        let file = project_file_path(&root, "Alpha");
        fs::create_dir_all(projects_dir(&root)).unwrap();
        fs::write(
            &file,
            r#"{
  "path": "Alpha",
  "about": "",
  "projectType": "knowledgeBase",
  "learningLanguage": "es"
}
"#,
        )
        .unwrap();
        let loaded = read_project_file(&file).unwrap();
        assert_eq!(loaded.project_type, PROJECT_TYPE_KNOWLEDGE_BASE);
        assert_eq!(loaded.learning_language, "");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_nested_path() {
        assert!(normalize_project_path("nested/deep").is_err());
        assert!(normalize_project_path("").is_err());
    }

    #[test]
    fn remap_rename_and_delete() {
        let root = temp_vault();
        write_project_file(
            &root,
            &ProjectProperties {
                path: "Alpha".into(),
                about: "A".into(),
                project_type: PROJECT_TYPE_KNOWLEDGE_BASE.into(),
                learning_language: String::new(),
            },
        )
        .unwrap();

        fs::rename(root.join("Alpha"), root.join("Gamma")).unwrap();
        remap_project_properties(&root, "Alpha", Some("Gamma")).unwrap();

        let file = project_file_path(&root, "Gamma");
        let loaded = read_project_file(&file).unwrap();
        assert_eq!(loaded.path, "Gamma");
        assert_eq!(loaded.about, "A");
        assert_eq!(loaded.project_type, PROJECT_TYPE_KNOWLEDGE_BASE);
        assert!(!project_file_path(&root, "Alpha").exists());

        fs::remove_dir_all(root.join("Gamma")).unwrap();
        remap_project_properties(&root, "Gamma", None).unwrap();
        assert!(!project_file_path(&root, "Gamma").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remap_move_into_nested_drops_props() {
        let root = temp_vault();
        write_project_file(
            &root,
            &ProjectProperties {
                path: "Alpha".into(),
                about: "A".into(),
                project_type: String::new(),
                learning_language: String::new(),
            },
        )
        .unwrap();

        fs::rename(root.join("Alpha"), root.join("nested").join("Alpha")).unwrap();
        remap_project_properties(&root, "Alpha", Some("nested/Alpha")).unwrap();
        assert!(!project_file_path(&root, "Alpha").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
