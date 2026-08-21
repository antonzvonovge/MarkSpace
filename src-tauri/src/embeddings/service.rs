//! Embeddings indexing service (runs inside `markspace-embeddings` process).

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};
use walkdir::WalkDir;

use super::chunk::{chunk_markdown, chunk_pdf};
use super::download::model_is_installed;
use super::index::{
    content_hash, content_hash_bytes, cosine_similarity, index_dir, is_indexed, is_indexed_hash,
    load_index, save_index, ChunkRecord, EmbeddingIndex, FileRecord,
};
use super::ipc::{ChildMessage, HostRequest};
use super::model::Embedder;
use super::types::{BackgroundJobPayload, EmbeddingsIndexStatus, SemanticHit, MODEL_ID};

const JOB_ID: &str = "embeddings-index";
const MAX_EMBED_BATCH: usize = 8;
const FILES_PER_TICK: usize = 1;
const MIN_PERSIST_INTERVAL: Duration = Duration::from_millis(1500);
const MAX_PERSIST_INTERVAL: Duration = Duration::from_secs(30);
const DEFAULT_DELAY_SECS: u32 = 5;

static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

enum Msg {
    OpenVault {
        vault_path: String,
        app_data: PathBuf,
        enabled: bool,
        delay_seconds: u32,
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
    SetPolicy {
        enabled: bool,
        delay_seconds: u32,
        reply: Sender<()>,
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
    Shutdown {
        reply: Sender<()>,
    },
}

struct WorkerState {
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
    reused_work: usize,
    last_persist: Option<Instant>,
    persist_interval: Duration,
    last_error: Option<String>,
    model_loaded: bool,
    enabled: bool,
    delay: Duration,
    /// When set, run `scan_vault` once this instant is reached.
    scan_at: Option<Instant>,
    emit_job: Sender<BackgroundJobPayload>,
}

impl WorkerState {
    fn new(emit_job: Sender<BackgroundJobPayload>) -> Self {
        Self {
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
            enabled: true,
            delay: Duration::from_secs(DEFAULT_DELAY_SECS as u64),
            scan_at: None,
            emit_job,
        }
    }

    fn emit_job(&self, status: &str, progress: u32, detail: Option<String>) {
        let payload = BackgroundJobPayload {
            id: JOB_ID.to_string(),
            label: "Indexing notes".into(),
            progress,
            status: status.into(),
            detail,
        };
        let _ = self.emit_job.send(payload);
    }

    fn set_delay_seconds(&mut self, secs: u32) {
        self.delay = Duration::from_secs(u64::from(secs.min(300)));
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
            ready: self.enabled
                && self.model_dir.is_some()
                && self.pending.is_empty()
                && !self.indexing
                && self.scan_at.is_none(),
            model_id: MODEL_ID.to_string(),
            indexed_files: self.index.files.len(),
            pending_files: self.pending.len(),
            indexing: self.enabled && (self.indexing || !self.pending.is_empty() || self.scan_at.is_some()),
            progress: self.progress,
            indexing_enabled: self.enabled,
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

    fn schedule_scan(&mut self) {
        if !self.enabled || self.model_dir.is_none() || self.vault_root.is_none() {
            self.scan_at = None;
            return;
        }
        self.scan_at = Some(Instant::now() + self.delay);
        if self.delay.is_zero() {
            // Process on next tick immediately.
        } else {
            self.indexing = true;
            self.progress = 0;
            self.emit_job(
                "running",
                0,
                Some(format!(
                    "Starting in {}s…",
                    self.delay.as_secs().max(1)
                )),
            );
        }
    }

    fn open_vault(
        &mut self,
        vault_path: String,
        app_data: PathBuf,
        enabled: bool,
        delay_seconds: u32,
    ) {
        self.enabled = enabled;
        self.set_delay_seconds(delay_seconds);
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
        self.scan_at = None;
        self.indexing = false;
        self.progress = 0;

        if self.model_dir.is_none() || !self.enabled {
            self.emit_job("done", 100, None);
            return;
        }
        self.schedule_scan();
    }

    fn model_available(&mut self, model_dir: PathBuf) {
        if !model_is_installed(&model_dir) {
            return;
        }
        self.model_dir = Some(model_dir);
        self.embedder = None;
        self.model_loaded = false;
        self.last_error = None;
        if self.enabled && self.vault_root.is_some() {
            self.schedule_scan();
        }
    }

    fn apply_policy(&mut self, enabled: bool, delay_seconds: u32) {
        self.set_delay_seconds(delay_seconds);
        let was_enabled = self.enabled;
        self.enabled = enabled;
        if !enabled {
            self.scan_at = None;
            self.pending.clear();
            self.debounce.clear();
            self.indexing = false;
            self.progress = 0;
            self.emit_job("done", 100, None);
            return;
        }
        if !was_enabled && self.model_dir.is_some() && self.vault_root.is_some() {
            self.schedule_scan();
        }
    }

    fn maybe_run_scheduled_scan(&mut self) {
        let Some(at) = self.scan_at else {
            return;
        };
        if Instant::now() < at {
            return;
        }
        self.scan_at = None;
        self.scan_vault();
    }

    fn scan_vault(&mut self) {
        if !self.enabled {
            return;
        }
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
            self.emit_job("done", 100, None);
        } else {
            self.indexing = true;
            let detail = self.work_detail();
            self.emit_job("running", 0, Some(detail));
        }
    }

    fn queue_path(&mut self, path: &str) {
        if !self.enabled || self.model_dir.is_none() {
            return;
        }
        let path = normalize_rel(path);
        if !path.ends_with(".md") && !path.ends_with(".pdf") {
            return;
        }
        if path.split('/').any(|p| p.starts_with('.')) {
            return;
        }
        let was_idle = self.pending.is_empty() && !self.indexing && self.scan_at.is_none();
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
        if to.ends_with(".md") || to.ends_with(".pdf") {
            self.queue_path(&to);
        }
        self.persist();
    }

    fn process_pending(&mut self) -> bool {
        if is_shutting_down() {
            self.persist();
            return false;
        }
        self.maybe_run_scheduled_scan();
        if !self.enabled {
            return false;
        }
        if self.pending.is_empty() {
            if self.indexing && self.scan_at.is_none() {
                self.indexing = false;
                self.progress = 100;
                self.persist();
                self.emit_job("done", 100, None);
            }
            return self.scan_at.is_some();
        }

        let now = Instant::now();
        let delay = self.delay;
        let ready: Vec<String> = self
            .pending
            .iter()
            .filter(|p| {
                self.debounce
                    .get(*p)
                    .map(|t| now.duration_since(*t) >= delay)
                    .unwrap_or(true)
            })
            .take(FILES_PER_TICK)
            .cloned()
            .collect();
        if ready.is_empty() {
            return true;
        }

        if let Err(e) = self.ensure_embedder() {
            self.last_error = Some(e.clone());
            self.emit_job("error", self.progress, Some(e));
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
            self.persist_checkpoint();
            if self.pending.is_empty() {
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
        if !self.enabled {
            return Err(
                "Semantic indexing is disabled for this vault. Enable it in Settings → Indexing."
                    .into(),
            );
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
            matches!(c, std::path::Component::Normal(n) if {
                let s = n.to_string_lossy();
                s.starts_with('.') && !s.eq_ignore_ascii_case(".folder.md")
            })
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

fn is_shutting_down() -> bool {
    SHUTTING_DOWN.load(Ordering::Relaxed)
}

fn worker_loop(rx: Receiver<Msg>, emit_job: Sender<BackgroundJobPayload>) {
    let mut state = WorkerState::new(emit_job);
    let mut queue: VecDeque<Msg> = VecDeque::new();

    loop {
        let waiting = queue.is_empty()
            && state.pending.is_empty()
            && state.scan_at.is_none();
        if waiting {
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
                    enabled,
                    delay_seconds,
                } => state.open_vault(vault_path, app_data, enabled, delay_seconds),
                Msg::ModelAvailable { model_dir } => state.model_available(model_dir),
                Msg::FileChanged { path } => state.queue_path(&path),
                Msg::FileRemoved { path } => state.remove_path(&path),
                Msg::FileRenamed { from, to } => state.rename_path(&from, &to),
                Msg::SetPolicy {
                    enabled,
                    delay_seconds,
                    reply,
                } => {
                    state.apply_policy(enabled, delay_seconds);
                    let _ = reply.send(());
                }
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
                    SHUTTING_DOWN.store(true, Ordering::Relaxed);
                    state.persist();
                    let _ = reply.send(());
                }
                Msg::Shutdown { reply } => {
                    SHUTTING_DOWN.store(true, Ordering::Relaxed);
                    state.persist();
                    let _ = reply.send(());
                    return;
                }
            }
        }

        state.process_pending();
    }
}

fn write_msg(out: &mut impl Write, msg: &ChildMessage) {
    if let Ok(line) = serde_json::to_string(msg) {
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}

/// Entry point for the `markspace-embeddings` binary: NDJSON over stdin/stdout.
pub fn run_stdio_server() {
    let (msg_tx, msg_rx) = mpsc::channel::<Msg>();
    let (job_tx, job_rx) = mpsc::channel::<BackgroundJobPayload>();
    let (out_tx, out_rx) = mpsc::channel::<ChildMessage>();

    thread::Builder::new()
        .name("embeddings-service".into())
        .spawn(move || worker_loop(msg_rx, job_tx))
        .expect("spawn embeddings service");

    // Forward job events to stdout writer.
    let out_jobs = out_tx.clone();
    thread::Builder::new()
        .name("embeddings-jobs".into())
        .spawn(move || {
            while let Ok(payload) = job_rx.recv() {
                let _ = out_jobs.send(ChildMessage::Job { payload });
            }
        })
        .expect("spawn job forwarder");

    // Serialize stdout writes on one thread.
    thread::Builder::new()
        .name("embeddings-stdout".into())
        .spawn(move || {
            let mut stdout = std::io::stdout().lock();
            while let Ok(msg) = out_rx.recv() {
                write_msg(&mut stdout, &msg);
            }
        })
        .expect("spawn stdout writer");

    let stdin = std::io::stdin();
    let reader = BufReader::new(stdin.lock());
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let req: HostRequest = match serde_json::from_str(line) {
            Ok(r) => r,
            Err(e) => {
                let _ = out_tx.send(ChildMessage::Error {
                    id: None,
                    message: format!("Invalid request: {e}"),
                });
                continue;
            }
        };
        match req {
            HostRequest::OpenVault {
                id,
                vault_path,
                app_data,
                enabled,
                delay_seconds,
            } => {
                let _ = msg_tx.send(Msg::OpenVault {
                    vault_path,
                    app_data: PathBuf::from(app_data),
                    enabled,
                    delay_seconds,
                });
                let _ = out_tx.send(ChildMessage::Ack { id });
            }
            HostRequest::ModelAvailable { id, model_dir } => {
                let _ = msg_tx.send(Msg::ModelAvailable {
                    model_dir: PathBuf::from(model_dir),
                });
                let _ = out_tx.send(ChildMessage::Ack { id });
            }
            HostRequest::FileChanged { path } => {
                let _ = msg_tx.send(Msg::FileChanged { path });
            }
            HostRequest::FileRemoved { path } => {
                let _ = msg_tx.send(Msg::FileRemoved { path });
            }
            HostRequest::FileRenamed { from, to } => {
                let _ = msg_tx.send(Msg::FileRenamed { from, to });
            }
            HostRequest::SetPolicy {
                id,
                enabled,
                delay_seconds,
            } => {
                let (reply_tx, reply_rx) = mpsc::channel();
                let _ = msg_tx.send(Msg::SetPolicy {
                    enabled,
                    delay_seconds,
                    reply: reply_tx,
                });
                let _ = reply_rx.recv();
                let _ = out_tx.send(ChildMessage::Ack { id });
            }
            HostRequest::Search { id, query, limit } => {
                let (reply_tx, reply_rx) = mpsc::channel();
                let _ = msg_tx.send(Msg::Search {
                    query,
                    limit,
                    reply: reply_tx,
                });
                match reply_rx.recv() {
                    Ok(Ok(hits)) => {
                        let _ = out_tx.send(ChildMessage::SearchResult {
                            id,
                            hits: Some(hits),
                            error: None,
                        });
                    }
                    Ok(Err(error)) => {
                        let _ = out_tx.send(ChildMessage::SearchResult {
                            id,
                            hits: None,
                            error: Some(error),
                        });
                    }
                    Err(_) => {
                        let _ = out_tx.send(ChildMessage::SearchResult {
                            id,
                            hits: None,
                            error: Some("Service disconnected".into()),
                        });
                    }
                }
            }
            HostRequest::Status { id } => {
                let (reply_tx, reply_rx) = mpsc::channel();
                let _ = msg_tx.send(Msg::Status { reply: reply_tx });
                match reply_rx.recv() {
                    Ok(status) => {
                        let _ = out_tx.send(ChildMessage::StatusResult { id, status });
                    }
                    Err(_) => {
                        let _ = out_tx.send(ChildMessage::Error {
                            id: Some(id),
                            message: "Service disconnected".into(),
                        });
                    }
                }
            }
            HostRequest::Flush { id } => {
                let (reply_tx, reply_rx) = mpsc::channel();
                let _ = msg_tx.send(Msg::Flush { reply: reply_tx });
                let _ = reply_rx.recv();
                let _ = out_tx.send(ChildMessage::FlushDone { id });
            }
            HostRequest::Shutdown { id } => {
                let (reply_tx, reply_rx) = mpsc::channel();
                let _ = msg_tx.send(Msg::Shutdown { reply: reply_tx });
                let _ = reply_rx.recv();
                let _ = out_tx.send(ChildMessage::ShutdownDone { id });
                break;
            }
        }
    }
}
