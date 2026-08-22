//! Folder properties stored as one file per folder under `.markspace/projects/`.
//!
//! Any vault folder (not the root) may have `about` (description and AI
//! instructions). Project type, learning language, and color apply only to
//! first-level folders (projects). Concurrent edits collide only when they
//! touch the same folder path.

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
const PROJECT_TYPE_DIARY: &str = "diary";

/// Material Design 500 swatches (lowercase `#rrggbb`). Empty = unset.
const PROJECT_COLORS: &[&str] = &[
    "#f44336", // Red
    "#e91e63", // Pink
    "#9c27b0", // Purple
    "#673ab7", // Deep purple
    "#3f51b5", // Indigo
    "#2196f3", // Blue
    "#03a9f4", // Light blue
    "#00bcd4", // Cyan
    "#009688", // Teal
    "#4caf50", // Green
    "#8bc34a", // Light green
    "#cddc39", // Lime
    "#ffc107", // Amber
    "#ff9800", // Orange
    "#ff5722", // Deep orange
    "#795548", // Brown
    "#607d8b", // Blue grey
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProperties {
    pub path: String,
    /// Description and AI instructions for this folder.
    #[serde(default)]
    pub about: String,
    /// `""` | `knowledgeBase` | `languageLearning` | `diary`.
    #[serde(default)]
    pub project_type: String,
    /// ISO 639-1 code when `project_type` is `languageLearning`; otherwise empty.
    #[serde(default)]
    pub learning_language: String,
    /// Optional Material swatch hex (`#rrggbb`); empty = unset.
    #[serde(default)]
    pub color: String,
}

fn normalize_project_type(raw: &str) -> String {
    match raw.trim() {
        PROJECT_TYPE_KNOWLEDGE_BASE => PROJECT_TYPE_KNOWLEDGE_BASE.to_string(),
        PROJECT_TYPE_LANGUAGE_LEARNING => PROJECT_TYPE_LANGUAGE_LEARNING.to_string(),
        PROJECT_TYPE_DIARY => PROJECT_TYPE_DIARY.to_string(),
        _ => String::new(),
    }
}

fn normalize_learning_language(project_type: &str, raw: &str) -> String {
    if project_type != PROJECT_TYPE_LANGUAGE_LEARNING {
        return String::new();
    }
    raw.trim().to_string()
}

fn normalize_project_color(raw: &str) -> String {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() {
        return String::new();
    }
    if PROJECT_COLORS.iter().any(|c| *c == trimmed) {
        trimmed
    } else {
        String::new()
    }
}

fn normalize_folder_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_matches('/').replace('\\', "/");
    if trimmed.is_empty() {
        return Err("Cannot set properties on vault root".into());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("Invalid folder path".into());
    }
    for component in Path::new(&trimmed).components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::CurDir
        ) {
            return Err("Invalid folder path".into());
        }
    }
    Ok(trimmed)
}

fn is_folder_path(path: &str) -> bool {
    normalize_folder_path(path).is_ok()
}

fn is_project_path(path: &str) -> bool {
    let Ok(trimmed) = normalize_folder_path(path) else {
        return false;
    };
    !trimmed.contains('/')
}

fn sanitize_props(mut props: ProjectProperties) -> ProjectProperties {
    if !is_project_path(&props.path) {
        props.project_type = String::new();
        props.learning_language = String::new();
        props.color = String::new();
        return props;
    }
    props.project_type = normalize_project_type(&props.project_type);
    props.learning_language =
        normalize_learning_language(&props.project_type, &props.learning_language);
    props.color = normalize_project_color(&props.color);
    props
}

fn path_is_self_or_descendant(path: &str, ancestor: &str) -> bool {
    path == ancestor || path.starts_with(&format!("{ancestor}/"))
}

fn remap_descendant_path(path: &str, from: &str, to: &str) -> String {
    if path == from {
        return to.to_string();
    }
    format!("{to}{}", &path[from.len()..])
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
    if !is_folder_path(&rel) {
        return None;
    }
    let about = value
        .get("about")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Some(sanitize_props(ProjectProperties {
        path: rel,
        about,
        project_type: value
            .get("projectType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        learning_language: value
            .get("learningLanguage")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        color: value
            .get("color")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    }))
}

fn write_project_file(root: &Path, props: &ProjectProperties) -> Result<(), String> {
    let props = sanitize_props(props.clone());
    let dir = projects_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create projects dir: {e}"))?;
    let file = project_file_path(root, &props.path);
    let body = serde_json::to_string_pretty(&json!({
        "path": props.path,
        "about": props.about,
        "projectType": props.project_type,
        "learningLanguage": props.learning_language,
        "color": props.color,
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
        color: String::new(),
    }
}

/// Load properties for a project folder. Missing file → empty defaults.
#[tauri::command(async)]
pub fn get_project_properties(
    path: String,
    state: State<VaultState>,
) -> Result<ProjectProperties, String> {
    let root = get_root(&state)?;
    let rel = normalize_folder_path(&path)?;
    if !path_exists_dir(&root, &rel) {
        return Err("Folder not found".into());
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
                color: props.color,
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
    color: String,
    state: State<VaultState>,
) -> Result<ProjectProperties, String> {
    let root = get_root(&state)?;
    let rel = normalize_folder_path(&path)?;
    if !path_exists_dir(&root, &rel) {
        return Err("Folder not found".into());
    }

    let props = sanitize_props(ProjectProperties {
        path: rel,
        about: about.trim().to_string(),
        project_type,
        learning_language,
        color,
    });

    // Drop any stale markers for this path (wrong hash filename).
    for (marker, existing) in scan_project_markers(&root)? {
        if existing.path == props.path && marker != project_file_path(&root, &props.path) {
            let _ = fs::remove_file(&marker);
        }
    }

    write_project_file(&root, &props)?;
    Ok(props)
}

/// Remap folder properties after rename/move (`to = Some`) or delete (`to = None`).
///
/// Remaps the folder itself and every stored descendant (`from/...`).
/// Moving a first-level project into a nested path keeps `about` and clears
/// project-only fields.
pub fn remap_project_properties(root: &Path, from: &str, to: Option<&str>) -> Result<(), String> {
    let from = from.trim().trim_matches('/').replace('\\', "/");
    if !is_folder_path(&from) {
        return Ok(());
    }
    let to = to.and_then(|t| {
        let t = t.trim().trim_matches('/').replace('\\', "/");
        is_folder_path(&t).then_some(t)
    });

    let markers = match scan_project_markers(root) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    for (_file, props) in markers {
        if !path_is_self_or_descendant(&props.path, &from) {
            continue;
        }
        let _ = remove_project_file(root, &props.path);
        if let Some(ref new_root) = to {
            let new_path = remap_descendant_path(&props.path, &from, new_root);
            if path_exists_dir(root, &new_path) {
                let next = sanitize_props(ProjectProperties {
                    path: new_path,
                    about: props.about,
                    project_type: props.project_type,
                    learning_language: props.learning_language,
                    color: props.color,
                });
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
            color: String::new(),
        };
        write_project_file(&root, &props).unwrap();
        let file = project_file_path(&root, "Alpha");
        let loaded = read_project_file(&file).unwrap();
        assert_eq!(loaded.about, "Notes about Alpha");
        assert_eq!(loaded.project_type, "");
        assert_eq!(loaded.learning_language, "");
        assert_eq!(loaded.color, "");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_and_read_color() {
        let root = temp_vault();
        let props = ProjectProperties {
            path: "Alpha".into(),
            about: String::new(),
            project_type: String::new(),
            learning_language: String::new(),
            color: "#e91e63".into(),
        };
        write_project_file(&root, &props).unwrap();
        let loaded = read_project_file(&project_file_path(&root, "Alpha")).unwrap();
        assert_eq!(loaded.color, "#e91e63");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn invalid_color_cleared_on_read() {
        let root = temp_vault();
        let file = project_file_path(&root, "Alpha");
        fs::create_dir_all(projects_dir(&root)).unwrap();
        fs::write(
            &file,
            r##"{
  "path": "Alpha",
  "about": "",
  "projectType": "",
  "learningLanguage": "",
  "color": "#ff00ff"
}
"##,
        )
        .unwrap();
        let loaded = read_project_file(&file).unwrap();
        assert_eq!(loaded.color, "");
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
            color: String::new(),
        };
        write_project_file(&root, &props).unwrap();
        let loaded = read_project_file(&project_file_path(&root, "Alpha")).unwrap();
        assert_eq!(loaded.project_type, PROJECT_TYPE_LANGUAGE_LEARNING);
        assert_eq!(loaded.learning_language, "es");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_and_read_diary() {
        let root = temp_vault();
        let props = ProjectProperties {
            path: "Journal".into(),
            about: "Personal diary".into(),
            project_type: PROJECT_TYPE_DIARY.into(),
            learning_language: "es".into(),
            color: String::new(),
        };
        write_project_file(&root, &props).unwrap();
        let loaded = read_project_file(&project_file_path(&root, "Journal")).unwrap();
        assert_eq!(loaded.project_type, PROJECT_TYPE_DIARY);
        // Learning language is cleared for non-language-learning types.
        assert_eq!(loaded.learning_language, "");
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
    fn accepts_nested_folder_path() {
        assert_eq!(
            normalize_folder_path("nested/deep").unwrap(),
            "nested/deep"
        );
        assert!(normalize_folder_path("").is_err());
        assert!(normalize_folder_path("..").is_err());
    }

    #[test]
    fn write_and_read_nested_about() {
        let root = temp_vault();
        write_project_file(
            &root,
            &ProjectProperties {
                path: "nested/deep".into(),
                about: "Deep notes".into(),
                project_type: PROJECT_TYPE_LANGUAGE_LEARNING.into(),
                learning_language: "es".into(),
                color: "#2196f3".into(),
            },
        )
        .unwrap();
        let loaded = read_project_file(&project_file_path(&root, "nested/deep")).unwrap();
        assert_eq!(loaded.path, "nested/deep");
        assert_eq!(loaded.about, "Deep notes");
        assert_eq!(loaded.project_type, "");
        assert_eq!(loaded.learning_language, "");
        assert_eq!(loaded.color, "");
        let _ = fs::remove_dir_all(&root);
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
                color: "#2196f3".into(),
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
        assert_eq!(loaded.color, "#2196f3");
        assert!(!project_file_path(&root, "Alpha").exists());

        fs::remove_dir_all(root.join("Gamma")).unwrap();
        remap_project_properties(&root, "Gamma", None).unwrap();
        assert!(!project_file_path(&root, "Gamma").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remap_move_into_nested_keeps_about_clears_project_fields() {
        let root = temp_vault();
        write_project_file(
            &root,
            &ProjectProperties {
                path: "Alpha".into(),
                about: "A".into(),
                project_type: PROJECT_TYPE_KNOWLEDGE_BASE.into(),
                learning_language: String::new(),
                color: "#2196f3".into(),
            },
        )
        .unwrap();
        fs::create_dir_all(root.join("Alpha").join("child")).unwrap();
        write_project_file(
            &root,
            &ProjectProperties {
                path: "Alpha/child".into(),
                about: "Child".into(),
                project_type: String::new(),
                learning_language: String::new(),
                color: String::new(),
            },
        )
        .unwrap();

        fs::rename(root.join("Alpha"), root.join("nested").join("Alpha")).unwrap();
        remap_project_properties(&root, "Alpha", Some("nested/Alpha")).unwrap();
        assert!(!project_file_path(&root, "Alpha").exists());
        assert!(!project_file_path(&root, "Alpha/child").exists());
        let moved = read_project_file(&project_file_path(&root, "nested/Alpha")).unwrap();
        assert_eq!(moved.about, "A");
        assert_eq!(moved.project_type, "");
        assert_eq!(moved.color, "");
        let child = read_project_file(&project_file_path(&root, "nested/Alpha/child")).unwrap();
        assert_eq!(child.about, "Child");
        let _ = fs::remove_dir_all(&root);
    }
}
