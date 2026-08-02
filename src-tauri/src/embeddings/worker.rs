use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use super::chunk::{chunk_markdown, chunk_pdf};
use super::index::{
    content_hash, content_hash_bytes, cosine_similarity, index_dir, is_indexed, is_indexed_hash,
    load_index, save_index, ChunkRecord, EmbeddingIndex, FileRecord,
};
use super::download::model_is_installed;
use super::model::{Embedder, MODEL_ID};

const JOB_ID: &str = "embeddings-index";
const EVENT_NAME: &str = "background-job://update";
const DEBOUNCE: Duration = Duration::from_millis(400);
const MAX_EMBED_BATCH: usize = 8;
/// One file per tick keeps search and status replies close behind indexing.
const FILES_PER_TICK: usize = 1;
const MIN_PERSIST_INTERVAL: Duration = Duration::from_millis(1500);
const MAX_PERSIST_INTERVAL: Duration = Duration::from_secs(30);
const FLUSH_TIMEOUT: Duration = Duration::from_millis(1500);
const SEARCH_TIMEOUT: Duration = Duration::from_secs(60);
const STATUS_TIMEOUT: Duration = Duration::from_secs(10);

static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJobPayload {
    pub id: String,
    pub label: String,
    pub progress: u32,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticHit {
    pub path: String,
    pub score: f32,
    pub snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    pub start_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingsIndexStatus {
    pub model_available: bool,
    pub ready: bool,
    pub model_id: String,
    pub indexed_files: usize,
    pub pending_files: usize,
    pub indexing: bool,
    pub progress: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

enum Msg {
    OpenVault {
        vault_path: String,
        app_data: PathBuf,
        app: AppHandle,
    },
    ModelAvailable {
        model_dir: PathBuf,
    },
    FileChanged {
        path: String,
    },
    FileRemoved {
        path: String,
    },
    FileRenamed {
        from: String,
        to: String,
    },
    Search {
        query: String,
        limit: usize,
        reply: Sender<Result<Vec<SemanticHit>, String>>,
    },
    Status {
        reply: Sender<EmbeddingsIndexStatus>,
    },
    Flush {
        reply: Sender<()>,
    },
}

struct WorkerState {
    app: Option<AppHandle>,
    vault_path: Option<String>,
    vault_root: Option<PathBuf>,
    index_dir: Option<PathBuf>,
    index: EmbeddingIndex,
    embedder: Option<Embedder>,
    model_dir: Option<PathBuf>,
    pending: HashSet<String>,
    debounce: HashMap<String, Instant>,
    dirty: bool,
    indexing: bool,
    progress: u32,
    total_work: usize,
    done_work: usize,
    /// Files whose embeddings were reused from the saved index on the last scan.
    reused_work: usize,
    last_persist: Option<Instant>,
    /// Keeps index writes at roughly 10% of indexing time on large vaults.
    persist_interval: Duration,
    last_error: Option<String>,
    model_loaded: bool,
}

impl WorkerState {
    fn new() -> Self {
        Self {
            app: None,
            vault_path: None,
            vault_root: None,
            index_dir: None,
            index: EmbeddingIndex::fresh(),
            embedder: None,
            model_dir: None,
            pending: HashSet::new(),
            debounce: HashMap::new(),
            dirty: false,
            indexing: false,
            progress: 0,
            total_work: 0,
            done_work: 0,
            reused_work: 0,
            last_persist: None,
            persist_interval: MIN_PERSIST_INTERVAL,
            last_error: None,
            model_loaded: false,
        }
    }

    fn emit_job(&self, status: &str, progress: u32, detail: Option<String>) {
        let Some(app) = &self.app else { return };
        let payload = BackgroundJobPayload {
            id: JOB_ID.to_string(),
            label: "Indexing notes".into(),
            progress,
            status: status.into(),
            detail,
        };
        let _ = app.emit(EVENT_NAME, payload);
    }

    fn ensure_embedder(&mut self) -> Result<(), String> {
        if self.embedder.is_some() {
            return Ok(());
        }
        let model_dir = self
            .model_dir
            .clone()
            .ok_or_else(|| "Embedding model directory not resolved".to_string())?;
        self.emit_job("running", 0, Some("Loading model…".into()));
        let embedder = Embedder::load(&model_dir)?;
        self.embedder = Some(embedder);
        self.model_loaded = true;
        Ok(())
    }

    fn status(&self) -> EmbeddingsIndexStatus {
        EmbeddingsIndexStatus {
            model_available: self.model_dir.is_some(),
            ready: self.model_dir.is_some() && self.pending.is_empty() && !self.indexing,
            model_id: MODEL_ID.to_string(),
            indexed_files: self.index.files.len(),
            pending_files: self.pending.len(),
            indexing: self.indexing || !self.pending.is_empty(),
            progress: self.progress,
            error: self.last_error.clone(),
        }
    }

    fn persist(&mut self) {
        if !self.dirty {
            return;
        }
        if let Some(dir) = &self.index_dir {
            let started = Instant::now();
            if let Err(e) = save_index(dir, &self.index) {
                self.last_error = Some(e);
            } else {
                self.dirty = false;
            }
            let elapsed = started.elapsed();
            self.last_persist = Some(Instant::now());
            self.persist_interval = (elapsed * 10).clamp(MIN_PERSIST_INTERVAL, MAX_PERSIST_INTERVAL);
        }
    }

    /// Checkpoint mid-run so a crash or quit never discards finished files.
    fn persist_checkpoint(&mut self) {
        if !self.dirty {
            return;
        }
        let due = self
            .last_persist
            .map(|t| t.elapsed() >= self.persist_interval)
            .unwrap_or(true);
        if due {
            self.persist();
        }
    }

    fn work_detail(&self) -> String {
        let total = self.total_work.max(self.done_work);
        if self.reused_work > 0 {
            format!(
                "{} / {} files · {} already indexed",
                self.done_work, total, self.reused_work
            )
        } else {
            format!("{} / {} files", self.done_work, total)
        }
    }

    fn open_vault(
        &mut self,
        vault_path: String,
        app_data: PathBuf,
        app: AppHandle,
    ) {
        self.app = Some(app);
        self.vault_path = Some(vault_path.clone());
        self.vault_root = Some(PathBuf::from(&vault_path));
        let dir = index_dir(&app_data, &vault_path);
        self.index_dir = Some(dir.clone());
        self.index = load_index(&dir);
        if !self.index.is_compatible() {
            self.index = EmbeddingIndex::fresh();
        }
        let app_model_dir = app_data.join("models").join(MODEL_ID);
        self.model_dir = model_is_installed(&app_model_dir).then_some(app_model_dir);
        self.embedder = None;
        self.model_loaded = false;
        self.pending.clear();
        self.debounce.clear();
        self.last_error = None;

        if self.model_dir.is_none() {
            self.indexing = false;
            self.progress = 0;
            return;
        }
        self.scan_vault();
    }

    fn model_available(&mut self, model_dir: PathBuf) {
        if !model_is_installed(&model_dir) {
            return;
        }
        self.model_dir = Some(model_dir);
        self.embedder = None;
        self.model_loaded = false;
        self.last_error = None;
        self.scan_vault();
    }

    fn scan_vault(&mut self) {
        let Some(root) = self.vault_root.clone() else {
            return;
        };
        let files = list_indexable_files(&root);
        let mut live: HashSet<String> = HashSet::new();
        for rel in &files {
            live.insert(rel.clone());
            let full = root.join(rel);
            if rel.ends_with(".pdf") {
                let Ok(bytes) = std::fs::read(&full) else {
                    self.pending.insert(rel.clone());
                    continue;
                };
                let hash = content_hash_bytes(&bytes);
                if !is_indexed_hash(&self.index, rel, &hash) {
                    self.pending.insert(rel.clone());
                }
            } else {
                let Ok(content) = std::fs::read_to_string(&full) else {
                    self.pending.insert(rel.clone());
                    continue;
                };
                if !is_indexed(&self.index, rel, &content) {
                    self.pending.insert(rel.clone());
                }
            }
        }
        let stale: Vec<String> = self
            .index
            .files
            .keys()
            .filter(|k| !live.contains(*k))
            .cloned()
            .collect();
        for k in stale {
            self.index.files.remove(&k);
            self.dirty = true;
        }
        self.total_work = self.pending.len();
        self.done_work = 0;
        self.reused_work = files.len().saturating_sub(self.pending.len());
        self.progress = if self.total_work == 0 { 100 } else { 0 };
        if self.pending.is_empty() {
            self.indexing = false;
            self.persist();
            // Hide indicator when already up to date.
            self.emit_job("done", 100, None);
        } else {
            self.indexing = true;
            let detail = self.work_detail();
            self.emit_job("running", 0, Some(detail));
        }
    }

    fn queue_path(&mut self, path: &str) {
        if self.model_dir.is_none() {
            return;
        }
        let path = normalize_rel(path);
        if !path.ends_with(".md") && !path.ends_with(".pdf") {
            return;
        }
        if path.split('/').any(|p| p.starts_with('.')) {
            return;
        }
        let was_idle = self.pending.is_empty() && !self.indexing;
        self.debounce.insert(path.clone(), Instant::now());
        self.pending.insert(path);
        if self.total_work < self.pending.len() + self.done_work {
            self.total_work = self.pending.len() + self.done_work;
        }
        self.indexing = true;
        if was_idle {
            self.done_work = 0;
            self.total_work = self.pending.len();
            self.reused_work = 0;
            self.progress = 0;
            let detail = self.work_detail();
            self.emit_job("running", 0, Some(detail));
        }
    }

    fn remove_path(&mut self, path: &str) {
        let path = normalize_rel(path);
        self.pending.remove(&path);
        self.debounce.remove(&path);
        if self.index.files.remove(&path).is_some() {
            self.dirty = true;
            self.persist();
        }
        // Prefix delete for folders
        let prefix = format!("{path}/");
        let keys: Vec<String> = self
            .index
            .files
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for k in keys {
            self.index.files.remove(&k);
            self.pending.remove(&k);
            self.dirty = true;
        }
        if self.dirty {
            self.persist();
        }
    }

    fn rename_path(&mut self, from: &str, to: &str) {
        let from = normalize_rel(from);
        let to = normalize_rel(to);
        if let Some(rec) = self.index.files.remove(&from) {
            self.index.files.insert(to.clone(), rec);
            self.dirty = true;
        }
        if self.pending.remove(&from) {
            self.pending.insert(to.clone());
        }
        if let Some(t) = self.debounce.remove(&from) {
            self.debounce.insert(to.clone(), t);
        }
        // Folder rename prefix
        if !from.ends_with(".md") && !from.ends_with(".pdf") {
            let from_prefix = format!("{from}/");
            let to_prefix = format!("{to}/");
            let keys: Vec<String> = self
                .index
                .files
                .keys()
                .filter(|k| k.starts_with(&from_prefix))
                .cloned()
                .collect();
            for k in keys {
                if let Some(rec) = self.index.files.remove(&k) {
                    let new_k = format!("{to_prefix}{}", &k[from_prefix.len()..]);
                    self.index.files.insert(new_k, rec);
                    self.dirty = true;
                }
            }
            let pending: Vec<String> = self
                .pending
                .iter()
                .filter(|k| k.starts_with(&from_prefix))
                .cloned()
                .collect();
            for k in pending {
                self.pending.remove(&k);
                self.pending
                    .insert(format!("{to_prefix}{}", &k[from_prefix.len()..]));
            }
        }
        if to.ends_with(".md") {
            self.queue_path(&to);
        }
        self.persist();
    }

    fn process_pending(&mut self) -> bool {
        if is_shutting_down() {
            self.persist();
            return false;
        }
        if self.pending.is_empty() {
            if self.indexing {
                self.indexing = false;
                self.progress = 100;
                self.persist();
                self.emit_job("done", 100, None);
            }
            return false;
        }

        // Honor debounce for recently queued paths.
        let now = Instant::now();
        let ready: Vec<String> = self
            .pending
            .iter()
            .filter(|p| {
                self.debounce
                    .get(*p)
                    .map(|t| now.duration_since(*t) >= DEBOUNCE)
                    .unwrap_or(true)
            })
            .take(FILES_PER_TICK)
            .cloned()
            .collect();
        if ready.is_empty() {
            return true; // wait for debounce
        }

        if let Err(e) = self.ensure_embedder() {
            self.last_error = Some(e.clone());
            self.emit_job("error", self.progress, Some(e));
            // Clear pending to avoid tight error loop; user can reopen vault.
            self.pending.clear();
            self.indexing = false;
            return false;
        }

        self.indexing = true;
        for path in ready {
            if is_shutting_down() {
                self.persist();
                return false;
            }
            self.pending.remove(&path);
            self.debounce.remove(&path);
            if let Err(e) = self.index_one(&path) {
                self.last_error = Some(e);
            }
            self.done_work += 1;
            let total = self.total_work.max(1);
            self.progress = ((self.done_work * 100) / total).min(99) as u32;
            // Checkpoint per file so an interrupted run resumes where it stopped.
            self.persist_checkpoint();
            if self.pending.is_empty() {
                // Finish here — the worker loop blocks on recv when idle and
                // would otherwise leave the UI stuck at "running · 100%".
                self.indexing = false;
                self.progress = 100;
                self.persist();
                self.emit_job("done", 100, Some(self.work_detail()));
                return false;
            }
            let detail = self.work_detail();
            self.emit_job("running", self.progress, Some(detail));
        }
        true
    }

    fn index_one(&mut self, rel: &str) -> Result<(), String> {
        let root = self
            .vault_root
            .as_ref()
            .ok_or_else(|| "No vault open".to_string())?;
        let full = root.join(rel);
        if !full.is_file() {
            self.index.files.remove(rel);
            self.dirty = true;
            return Ok(());
        }

        let (hash, chunks) = if rel.ends_with(".pdf") {
            let bytes = std::fs::read(&full)
                .map_err(|e| format!("Cannot read {rel} for embeddings: {e}"))?;
            let hash = content_hash_bytes(&bytes);
            if let Some(existing) = self.index.files.get(rel) {
                if existing.content_hash == hash {
                    return Ok(());
                }
            }
            let pages = match crate::pdf_text::extract_pdf_pages(&bytes) {
                Ok(p) => p,
                Err(_) => {
                    // Unreadable / encrypted / empty text layer — store empty record.
                    self.index.files.insert(
                        rel.to_string(),
                        FileRecord {
                            content_hash: hash,
                            chunks: Vec::new(),
                        },
                    );
                    self.dirty = true;
                    return Ok(());
                }
            };
            let chunks = chunk_pdf(&pages);
            (hash, chunks)
        } else {
            let content = std::fs::read_to_string(&full)
                .map_err(|e| format!("Cannot read {rel} for embeddings: {e}"))?;
            let hash = content_hash(&content);
            if let Some(existing) = self.index.files.get(rel) {
                if existing.content_hash == hash {
                    return Ok(());
                }
            }
            (hash, chunk_markdown(&content))
        };

        if chunks.is_empty() {
            self.index.files.insert(
                rel.to_string(),
                FileRecord {
                    content_hash: hash,
                    chunks: Vec::new(),
                },
            );
            self.dirty = true;
            return Ok(());
        }

        let embedder = self
            .embedder
            .as_ref()
            .ok_or_else(|| "Embedder not loaded".to_string())?;

        let mut records = Vec::with_capacity(chunks.len());
        for batch in chunks.chunks(MAX_EMBED_BATCH) {
            // Drop partial work on shutdown; the file is re-queued on next scan.
            if is_shutting_down() {
                return Ok(());
            }
            let texts: Vec<String> = batch.iter().map(|c| c.text.clone()).collect();
            let vectors = embedder.embed(&texts)?;
            for (chunk, emb) in batch.iter().zip(vectors.into_iter()) {
                records.push(ChunkRecord {
                    heading: chunk.heading.clone(),
                    snippet: chunk.snippet.clone(),
                    start_line: chunk.start_line,
                    embedding: emb,
                });
            }
        }

        self.index.files.insert(
            rel.to_string(),
            FileRecord {
                content_hash: hash,
                chunks: records,
            },
        );
        self.dirty = true;
        Ok(())
    }

    fn search(&mut self, query: &str, limit: usize) -> Result<Vec<SemanticHit>, String> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        if self.model_dir.is_none() {
            return Err(
                "Local semantic search model is not installed. Download it in Settings → AI."
                    .into(),
            );
        }
        if self.index.files.is_empty() {
            return Err("Semantic index is empty; wait for indexing or use search_notes".into());
        }
        self.ensure_embedder()?;
        let embedder = self
            .embedder
            .as_ref()
            .ok_or_else(|| "Embedder not loaded".to_string())?;
        let q_emb = embedder.embed_one(q)?;

        let mut hits: Vec<SemanticHit> = Vec::new();
        for (path, file) in &self.index.files {
            for chunk in &file.chunks {
                let score = cosine_similarity(&q_emb, &chunk.embedding);
                hits.push(SemanticHit {
                    path: path.clone(),
                    score,
                    snippet: chunk.snippet.clone(),
                    heading: chunk.heading.clone(),
                    start_line: chunk.start_line,
                });
            }
        }
        hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(limit.max(1).min(50));
        Ok(hits)
    }
}

fn normalize_rel(path: &str) -> String {
    path.trim().trim_start_matches('/').replace('\\', "/")
}

fn list_indexable_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("");
        if ext != "md" && ext != "pdf" {
            continue;
        }
        if path.components().any(|c| {
            matches!(c, std::path::Component::Normal(n) if n.to_string_lossy().starts_with('.'))
        }) {
            continue;
        }
        if let Ok(rel) = path.strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    out.sort();
    out
}

fn worker_loop(rx: Receiver<Msg>) {
    let mut state = WorkerState::new();
    let mut queue: VecDeque<Msg> = VecDeque::new();

    loop {
        // Block if nothing pending; otherwise poll with timeout for debounce.
        if queue.is_empty() && state.pending.is_empty() {
            match rx.recv() {
                Ok(msg) => queue.push_back(msg),
                Err(_) => break,
            }
        } else {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(msg) => queue.push_back(msg),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        while let Some(msg) = queue.pop_front() {
            match msg {
                Msg::OpenVault {
                    vault_path,
                    app_data,
                    app,
                } => state.open_vault(vault_path, app_data, app),
                Msg::ModelAvailable { model_dir } => state.model_available(model_dir),
                Msg::FileChanged { path } => state.queue_path(&path),
                Msg::FileRemoved { path } => state.remove_path(&path),
                Msg::FileRenamed { from, to } => state.rename_path(&from, &to),
                Msg::Search {
                    query,
                    limit,
                    reply,
                } => {
                    let _ = reply.send(state.search(&query, limit));
                }
                Msg::Status { reply } => {
                    let _ = reply.send(state.status());
                }
                Msg::Flush { reply } => {
                    state.persist();
                    let _ = reply.send(());
                }
            }
        }

        state.process_pending();
    }
}

pub struct EmbeddingsRuntime {
    tx: Mutex<Option<Sender<Msg>>>,
}

impl Default for EmbeddingsRuntime {
    fn default() -> Self {
        Self {
            tx: Mutex::new(None),
        }
    }
}

impl EmbeddingsRuntime {
    fn send(&self, msg: Msg) {
        if let Some(tx) = self.tx.lock().as_ref() {
            let _ = tx.send(msg);
        }
    }
}

static RUNTIME: OnceLock<Arc<EmbeddingsRuntime>> = OnceLock::new();

pub fn embeddings_runtime() -> Arc<EmbeddingsRuntime> {
    RUNTIME
        .get_or_init(|| Arc::new(EmbeddingsRuntime::default()))
        .clone()
}

pub fn start_embeddings_runtime() {
    let rt = embeddings_runtime();
    let mut guard = rt.tx.lock();
    if guard.is_some() {
        return;
    }
    let (tx, rx) = mpsc::channel::<Msg>();
    *guard = Some(tx);
    thread::Builder::new()
        .name("embeddings-worker".into())
        .spawn(move || worker_loop(rx))
        .expect("spawn embeddings worker");
}

pub fn notify_vault_opened(app: &AppHandle, vault_path: &Path) {
    let app_data = match app.path().app_data_dir() {
        Ok(p) => p,
        Err(_) => return,
    };
    let vault = vault_path.to_string_lossy().to_string();
    embeddings_runtime().send(Msg::OpenVault {
        vault_path: vault,
        app_data,
        app: app.clone(),
    });
}

pub fn notify_model_available(model_dir: PathBuf) {
    embeddings_runtime().send(Msg::ModelAvailable { model_dir });
}

fn is_shutting_down() -> bool {
    SHUTTING_DOWN.load(Ordering::Relaxed)
}

/// Stop indexing and write pending index changes before the process exits.
/// Bounded so quitting never blocks the UI into an "app not responding" prompt.
pub fn flush_index() {
    SHUTTING_DOWN.store(true, Ordering::Relaxed);
    let (reply_tx, reply_rx) = mpsc::channel();
    embeddings_runtime().send(Msg::Flush { reply: reply_tx });
    let _ = reply_rx.recv_timeout(FLUSH_TIMEOUT);
}

pub fn notify_file_changed(path: &str) {
    embeddings_runtime().send(Msg::FileChanged {
        path: path.to_string(),
    });
}

pub fn notify_file_removed(path: &str) {
    embeddings_runtime().send(Msg::FileRemoved {
        path: path.to_string(),
    });
}

pub fn notify_file_renamed(from: &str, to: &str) {
    embeddings_runtime().send(Msg::FileRenamed {
        from: from.to_string(),
        to: to.to_string(),
    });
}

/// Async so Tauri keeps this off the main thread; the worker reply is awaited
/// on a blocking pool thread instead of freezing the UI.
#[tauri::command]
pub async fn semantic_search_notes(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SemanticHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (reply_tx, reply_rx) = mpsc::channel();
        embeddings_runtime().send(Msg::Search {
            query,
            limit: limit.unwrap_or(10),
            reply: reply_tx,
        });
        reply_rx
            .recv_timeout(SEARCH_TIMEOUT)
            .map_err(|_| "Semantic search timed out".to_string())?
    })
    .await
    .map_err(|e| format!("Semantic search failed: {e}"))?
}

#[tauri::command]
pub async fn get_embeddings_index_status() -> Result<EmbeddingsIndexStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (reply_tx, reply_rx) = mpsc::channel();
        embeddings_runtime().send(Msg::Status { reply: reply_tx });
        reply_rx
            .recv_timeout(STATUS_TIMEOUT)
            .map_err(|_| "Embeddings status timed out".to_string())
    })
    .await
    .map_err(|e| format!("Embeddings status failed: {e}"))?
}
