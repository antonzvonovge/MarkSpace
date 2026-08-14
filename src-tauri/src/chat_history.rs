use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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
    /// Sticky Reasoning toggle (composer). Absent on older threads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_reasoning: Option<bool>,
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

fn index_path(dir: &PathBuf) -> PathBuf {
    dir.join("index.json")
}

fn thread_path(dir: &PathBuf, thread_id: &str) -> PathBuf {
    dir.join(format!("{thread_id}.json"))
}

fn sanitize_open_tabs(index: &mut ChatIndex) {
    let known: std::collections::HashSet<&str> =
        index.threads.iter().map(|t| t.id.as_str()).collect();
    index.open_tab_ids.retain(|id| known.contains(id.as_str()));

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

fn read_index(dir: &PathBuf) -> Result<ChatIndex, String> {
    let path = index_path(dir);
    if !path.exists() {
        return Ok(ChatIndex::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read chat index: {e}"))?;
    let mut index: ChatIndex =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid chat index: {e}"))?;
    sanitize_open_tabs(&mut index);
    Ok(index)
}

fn write_index(dir: &PathBuf, index: &ChatIndex) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create chats dir: {e}"))?;
    let path = index_path(dir);
    let raw = serde_json::to_string_pretty(index).map_err(|e| format!("Cannot serialize index: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("Cannot write chat index: {e}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatThreadsResponse {
    pub threads: Vec<ChatThreadMeta>,
    pub active_thread_id: Option<String>,
    pub open_tab_ids: Vec<String>,
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
    serde_json::from_str(&raw).map_err(|e| format!("Invalid chat thread: {e}"))
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
    fs::write(&path, raw).map_err(|e| format!("Cannot write chat thread: {e}"))?;

    let meta = ChatThreadMeta {
        id: thread.id.clone(),
        title: thread.title.clone(),
        created_at: thread.created_at,
        updated_at: thread.updated_at,
        mode: thread.mode.clone(),
        model_id: thread.model_id.clone(),
        project_path: thread.project_path.clone(),
        gem_id: thread.gem_id.clone(),
    };

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

    if index.open_tab_ids.is_empty() {
        index.active_thread_id = None;
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
    })
}
