use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

static ATOMIC_WRITE_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatThreadMeta {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub mode: String,
    pub model_id: String,
    /// Optional vault project (first-level folder) for this thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    /// Optional Gem id (`.markspace/gems/<id>.json`) for this thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gem_id: Option<String>,
    /// User-set title; skip first-message / LLM auto-rename.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_locked: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatThreadFile {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub mode: String,
    pub model_id: String,
    /// Optional vault project (first-level folder) for this thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    /// Optional Gem id (`.markspace/gems/<id>.json`) for this thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gem_id: Option<String>,
    /// User-set title; skip first-message / LLM auto-rename.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_locked: Option<bool>,
    /// Sticky Reasoning toggle (composer). Absent on older threads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_reasoning: Option<bool>,
    /// `off` | `auto` | `on`. Absent on older threads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_mode: Option<String>,
    /// Skip per-command terminal approval for this thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_allow_for_chat: Option<bool>,
    /// Measured context baseline (next prompt, empty draft).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_anchor_tokens: Option<i64>,
    /// `messages.len` when `context_anchor_tokens` was recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_anchor_message_count: Option<i64>,
    pub messages: Value,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ChatIndex {
    threads: Vec<ChatThreadMeta>,
    active_thread_id: Option<String>,
    /// Open chat tabs (Cursor-style). Closing a tab removes it here but keeps history.
    #[serde(default)]
    open_tab_ids: Vec<String>,
    /// Pinned open tabs (subset of `open_tab_ids`).
    #[serde(default)]
    pinned_tab_ids: Vec<String>,
}

fn vault_key(vault_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(vault_path.as_bytes());
    let digest = hasher.finalize();
    hex_encode(&digest[..16])
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn chats_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    Ok(base.join("chats"))
}

fn vault_dir(app: &AppHandle, vault_path: &str) -> Result<PathBuf, String> {
    let path = vault_path.trim();
    if path.is_empty() {
        return Err("Vault path required".into());
    }
    Ok(chats_root(app)?.join(vault_key(path)))
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.json")
}

fn thread_path(dir: &Path, thread_id: &str) -> PathBuf {
    dir.join(format!("{thread_id}.json"))
}

fn meta_from_thread(thread: &ChatThreadFile) -> ChatThreadMeta {
    ChatThreadMeta {
        id: thread.id.clone(),
        title: thread.title.clone(),
        created_at: thread.created_at,
        updated_at: thread.updated_at,
        mode: thread.mode.clone(),
        model_id: thread.model_id.clone(),
        project_path: thread.project_path.clone(),
        gem_id: thread.gem_id.clone(),
        title_locked: thread.title_locked.filter(|locked| *locked),
    }
}

fn is_thread_filename(name: &str) -> bool {
    name.ends_with(".json")
        && name != "index.json"
        && !name.starts_with('.')
        && !name.ends_with(".tmp")
}

fn thread_ids_on_disk(dir: &Path) -> std::collections::HashSet<String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return std::collections::HashSet::new(),
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !is_thread_filename(&name) {
                return None;
            }
            Some(name.trim_end_matches(".json").to_string())
        })
        .collect()
}

fn reconcile_index(dir: &Path, mut index: ChatIndex) -> (ChatIndex, bool) {
    let disk_ids = thread_ids_on_disk(dir);
    let index_ids: std::collections::HashSet<String> =
        index.threads.iter().map(|t| t.id.clone()).collect();
    if disk_ids == index_ids {
        sanitize_open_tabs(&mut index);
        return (index, false);
    }

    index.threads.retain(|t| disk_ids.contains(&t.id));
    let known: std::collections::HashSet<String> =
        index.threads.iter().map(|t| t.id.clone()).collect();
    for id in &disk_ids {
        if known.contains(id) {
            continue;
        }
        let path = thread_path(dir, id);
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(thread) = parse_thread_json(&raw) else {
            continue;
        };
        if thread.id.trim().is_empty() {
            continue;
        }
        index.threads.push(meta_from_thread(&thread));
    }
    index.threads.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sanitize_open_tabs(&mut index);
    (index, true)
}

fn sanitize_open_tabs(index: &mut ChatIndex) {
    let known: std::collections::HashSet<&str> =
        index.threads.iter().map(|t| t.id.as_str()).collect();
    index.open_tab_ids.retain(|id| known.contains(id.as_str()));
    index
        .pinned_tab_ids
        .retain(|id| index.open_tab_ids.iter().any(|t| t == id));

    // Migrate older indexes that only had activeThreadId.
    if index.open_tab_ids.is_empty() {
        if let Some(ref active) = index.active_thread_id {
            if known.contains(active.as_str()) {
                index.open_tab_ids.push(active.clone());
            }
        }
    }

    if let Some(ref active) = index.active_thread_id {
        if !index.open_tab_ids.iter().any(|id| id == active) {
            index.active_thread_id = index.open_tab_ids.first().cloned();
        }
    } else if !index.open_tab_ids.is_empty() {
        // Keep active null when user closed all tabs intentionally — only
        // fill active if it was unset while tabs exist from migration.
    }
}

fn load_index_file(dir: &Path) -> ChatIndex {
    let path = index_path(dir);
    let Ok(raw) = fs::read_to_string(&path) else {
        return ChatIndex::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn read_index(dir: &PathBuf) -> Result<ChatIndex, String> {
    let (index, changed) = reconcile_index(dir, load_index_file(dir));
    if changed {
        write_index(dir, &index)?;
    }
    Ok(index)
}

fn write_index(dir: &PathBuf, index: &ChatIndex) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create chats dir: {e}"))?;
    let path = index_path(dir);
    let raw = serde_json::to_string_pretty(index).map_err(|e| format!("Cannot serialize index: {e}"))?;
    atomic_write(&path, &raw)
}

fn atomic_write(path: &Path, raw: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot write {}", path.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file.json".into());
    let seq = ATOMIC_WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(".{}.{}.{}.tmp", name, std::process::id(), seq));
    fs::write(&tmp, raw).map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;

    #[cfg(windows)]
    {
        let bak = parent.join(format!(".{}.{}.bak", name, seq));
        let had_dest = path.exists();
        if had_dest {
            if let Err(e) = fs::rename(path, &bak) {
                let _ = fs::remove_file(&tmp);
                return Err(format!("Cannot replace {}: {e}", path.display()));
            }
        }
        if let Err(e) = fs::rename(&tmp, path) {
            if had_dest {
                let _ = fs::rename(&bak, path);
            }
            let _ = fs::remove_file(&tmp);
            return Err(format!("Cannot replace {}: {e}", path.display()));
        }
        if had_dest {
            let _ = fs::remove_file(&bak);
        }
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("Cannot replace {}: {e}", path.display())
        })
    }
}

fn parse_thread_json(raw: &str) -> Result<ChatThreadFile, String> {
    match serde_json::from_str(raw) {
        Ok(thread) => Ok(thread),
        Err(err) => {
            let mut de = serde_json::Deserializer::from_str(raw).into_iter::<ChatThreadFile>();
            match de.next() {
                Some(Ok(thread)) => Ok(thread),
                _ => Err(format!("Invalid chat thread: {err}")),
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatThreadsResponse {
    pub threads: Vec<ChatThreadMeta>,
    pub active_thread_id: Option<String>,
    pub open_tab_ids: Vec<String>,
    #[serde(default)]
    pub pinned_tab_ids: Vec<String>,
}

#[tauri::command(async)]
pub fn list_chat_threads(
    vault_path: String,
    app: AppHandle,
) -> Result<ChatThreadsResponse, String> {
    let dir = vault_dir(&app, &vault_path)?;
    let index = read_index(&dir)?;
    Ok(ChatThreadsResponse {
        threads: index.threads,
        active_thread_id: index.active_thread_id,
        open_tab_ids: index.open_tab_ids,
        pinned_tab_ids: index.pinned_tab_ids,
    })
}

#[tauri::command(async)]
pub fn get_chat_thread(
    vault_path: String,
    thread_id: String,
    app: AppHandle,
) -> Result<ChatThreadFile, String> {
    let dir = vault_dir(&app, &vault_path)?;
    let path = thread_path(&dir, &thread_id);
    if !path.exists() {
        return Err("Chat thread not found".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read chat thread: {e}"))?;
    let thread = parse_thread_json(&raw)?;
    if serde_json::from_str::<ChatThreadFile>(&raw).is_err() {
        if let Ok(fixed) = serde_json::to_string_pretty(&thread) {
            let _ = atomic_write(&path, &fixed);
        }
    }
    Ok(thread)
}

/// Absolute filesystem path of the thread JSON under the app data chats dir.
#[tauri::command(async)]
pub fn get_chat_thread_path(
    vault_path: String,
    thread_id: String,
    app: AppHandle,
) -> Result<String, String> {
    let id = thread_id.trim();
    if id.is_empty() {
        return Err("Thread id required".into());
    }
    let dir = vault_dir(&app, &vault_path)?;
    Ok(thread_path(&dir, id).to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn upsert_chat_thread(
    vault_path: String,
    thread: ChatThreadFile,
    app: AppHandle,
) -> Result<ChatThreadMeta, String> {
    if thread.id.trim().is_empty() {
        return Err("Thread id required".into());
    }
    let dir = vault_dir(&app, &vault_path)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create chats dir: {e}"))?;

    let path = thread_path(&dir, &thread.id);
    let raw =
        serde_json::to_string_pretty(&thread).map_err(|e| format!("Cannot serialize thread: {e}"))?;
    atomic_write(&path, &raw)?;

    let meta = meta_from_thread(&thread);

    let mut index = read_index(&dir)?;
    if let Some(existing) = index.threads.iter_mut().find(|t| t.id == meta.id) {
        *existing = meta.clone();
    } else {
        index.threads.insert(0, meta.clone());
    }
    index.threads.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    write_index(&dir, &index)?;
    Ok(meta)
}

#[tauri::command(async)]
pub fn delete_chat_thread(
    vault_path: String,
    thread_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let dir = vault_dir(&app, &vault_path)?;
    let path = thread_path(&dir, &thread_id);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Cannot delete chat thread: {e}"))?;
    }
    let mut index = read_index(&dir)?;
    index.threads.retain(|t| t.id != thread_id);
    index.open_tab_ids.retain(|id| id != &thread_id);
    index.pinned_tab_ids.retain(|id| id != &thread_id);
    if index.active_thread_id.as_deref() == Some(thread_id.as_str()) {
        index.active_thread_id = index.open_tab_ids.first().cloned();
    }
    write_index(&dir, &index)?;
    Ok(())
}

#[tauri::command(async)]
pub fn set_active_chat_thread(
    vault_path: String,
    thread_id: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    let dir = vault_dir(&app, &vault_path)?;
    let mut index = read_index(&dir)?;
    if let Some(ref id) = thread_id {
        if !index.threads.iter().any(|t| &t.id == id) {
            return Err("Chat thread not found".into());
        }
        if !index.open_tab_ids.iter().any(|t| t == id) {
            index.open_tab_ids.push(id.clone());
        }
    }
    index.active_thread_id = thread_id;
    write_index(&dir, &index)?;
    Ok(())
}

#[tauri::command(async)]
pub fn set_open_chat_tabs(
    vault_path: String,
    open_tab_ids: Vec<String>,
    active_thread_id: Option<String>,
    pinned_tab_ids: Vec<String>,
    app: AppHandle,
) -> Result<ChatThreadsResponse, String> {
    let dir = vault_dir(&app, &vault_path)?;
    let mut index = read_index(&dir)?;
    let known: std::collections::HashSet<String> =
        index.threads.iter().map(|t| t.id.clone()).collect();
    index.open_tab_ids = open_tab_ids
        .into_iter()
        .filter(|id| known.contains(id))
        .collect();
    index.pinned_tab_ids = pinned_tab_ids
        .into_iter()
        .filter(|id| index.open_tab_ids.iter().any(|t| t == id))
        .collect();

    if index.open_tab_ids.is_empty() {
        index.active_thread_id = None;
        index.pinned_tab_ids.clear();
    } else {
        index.active_thread_id = match active_thread_id {
            Some(id) if index.open_tab_ids.iter().any(|t| t == &id) => Some(id),
            _ => index.open_tab_ids.last().cloned(),
        };
    }

    write_index(&dir, &index)?;
    Ok(ChatThreadsResponse {
        threads: index.threads,
        active_thread_id: index.active_thread_id,
        open_tab_ids: index.open_tab_ids,
        pinned_tab_ids: index.pinned_tab_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "markspace-chat-history-{}-{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_thread(id: &str, title: &str, updated_at: i64) -> String {
        format!(
            r#"{{
  "id": "{id}",
  "title": "{title}",
  "createdAt": 1,
  "updatedAt": {updated_at},
  "mode": "ask",
  "modelId": "test",
  "messages": []
}}"#
        )
    }

    #[test]
    fn atomic_write_replaces_without_leaving_tmp() {
        let dir = tmp_dir();
        let path = dir.join("index.json");
        atomic_write(&path, "{\"ok\":1}").unwrap();
        atomic_write(&path, "{\"ok\":2}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"ok\":2}");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.path() != path)
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_index_rebuilds_from_thread_files_when_index_is_stale() {
        let dir = tmp_dir();
        fs::write(dir.join("aaa.json"), sample_thread("aaa", "First", 20)).unwrap();
        fs::write(dir.join("bbb.json"), sample_thread("bbb", "Second", 10)).unwrap();
        fs::write(
            dir.join("index.json"),
            r#"{"threads":[{"id":"aaa","title":"First","createdAt":1,"updatedAt":20,"mode":"ask","modelId":"test"}],"activeThreadId":"aaa","openTabIds":["aaa"]}"#,
        )
        .unwrap();

        let index = read_index(&dir).unwrap();
        let ids: Vec<_> = index.threads.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["aaa", "bbb"]);
        assert_eq!(index.threads[1].title, "Second");

        let persisted: ChatIndex =
            serde_json::from_str(&fs::read_to_string(dir.join("index.json")).unwrap()).unwrap();
        assert_eq!(persisted.threads.len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_index_recovers_when_index_is_missing() {
        let dir = tmp_dir();
        fs::write(dir.join("aaa.json"), sample_thread("aaa", "Only", 5)).unwrap();
        let index = read_index(&dir).unwrap();
        assert_eq!(index.threads.len(), 1);
        assert_eq!(index.threads[0].id, "aaa");
        assert!(dir.join("index.json").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
