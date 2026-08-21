//! Host side: spawn `markspace-embeddings` and proxy notify/search over NDJSON.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use super::ipc::{ChildMessage, HostRequest};
use super::types::{EmbeddingsIndexStatus, SemanticHit};

const EVENT_NAME: &str = "background-job://update";
const FLUSH_TIMEOUT: Duration = Duration::from_millis(1500);
const SEARCH_TIMEOUT: Duration = Duration::from_secs(60);
const STATUS_TIMEOUT: Duration = Duration::from_secs(10);
const ACK_TIMEOUT: Duration = Duration::from_secs(10);

static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

enum HostMsg {
    OpenVault {
        vault_path: String,
        app_data: PathBuf,
        enabled: bool,
        delay_seconds: u32,
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
}

struct Pending {
    kind: PendingKind,
}

enum PendingKind {
    Ack(Sender<()>),
    Search(Sender<Result<Vec<SemanticHit>, String>>),
    Status(Sender<EmbeddingsIndexStatus>),
    Flush(Sender<()>),
}

struct ChildSession {
    child: Child,
    stdin: ChildStdin,
}

struct HostState {
    tx: Mutex<Option<Sender<HostMsg>>>,
}

impl Default for HostState {
    fn default() -> Self {
        Self {
            tx: Mutex::new(None),
        }
    }
}

impl HostState {
    fn send(&self, msg: HostMsg) {
        if let Some(tx) = self.tx.lock().as_ref() {
            let _ = tx.send(msg);
        }
    }
}

static RUNTIME: OnceLock<Arc<HostState>> = OnceLock::new();

fn runtime() -> Arc<HostState> {
    RUNTIME
        .get_or_init(|| Arc::new(HostState::default()))
        .clone()
}

fn sidecar_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let exe_name = if cfg!(windows) {
        "markspace-embeddings.exe"
    } else {
        "markspace-embeddings"
    };

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join(exe_name));
            // Packaged macOS / some layouts
            out.push(dir.join("binaries").join(exe_name));
            // Dev: target/{debug,release}/ beside the main binary
            if let Some(parent) = dir.parent() {
                out.push(parent.join(exe_name));
                out.push(parent.join("debug").join(exe_name));
                out.push(parent.join("release").join(exe_name));
            }
        }
    }

    // Staged Tauri externalBin paths (with target triple).
    let triple = option_env!("TARGET").unwrap_or("unknown");
    let staged = format!("markspace-embeddings-{triple}");
    let staged_exe = if cfg!(windows) {
        format!("{staged}.exe")
    } else {
        staged
    };

    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let binaries = PathBuf::from(manifest).join("binaries");
        out.push(binaries.join(&staged_exe));
        out.push(binaries.join(exe_name));
    }

    // Relative to cwd (tauri dev often runs from src-tauri).
    out.push(PathBuf::from("binaries").join(&staged_exe));
    out.push(PathBuf::from(exe_name));

    out
}

fn resolve_sidecar_path() -> Result<PathBuf, String> {
    for path in sidecar_candidates() {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(format!(
        "markspace-embeddings binary not found. Tried: {}",
        sidecar_candidates()
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn start_child_io(
    pending: Arc<Mutex<HashMap<u64, Pending>>>,
    app_slot: Arc<Mutex<Option<AppHandle>>>,
) -> Result<(ChildSession, thread::JoinHandle<()>), String> {
    let path = resolve_sidecar_path()?;
    let mut cmd = Command::new(&path);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn embeddings process ({}): {e}", path.display()))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "embeddings process stdin missing".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "embeddings process stdout missing".to_string())?;

    let reader = thread::Builder::new()
        .name("embeddings-host-stdout".into())
        .spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let msg: ChildMessage = match serde_json::from_str(line) {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("[embeddings-host] bad child message: {e}");
                        continue;
                    }
                };
                handle_child_message(msg, &pending, &app_slot);
            }
        })
        .map_err(|e| format!("Failed to spawn stdout reader: {e}"))?;

    Ok((ChildSession { child, stdin }, reader))
}

fn handle_child_message(
    msg: ChildMessage,
    pending: &Mutex<HashMap<u64, Pending>>,
    app_slot: &Mutex<Option<AppHandle>>,
) {
    match msg {
        ChildMessage::Job { payload } => {
            if let Some(app) = app_slot.lock().as_ref() {
                let _ = app.emit(EVENT_NAME, payload);
            }
        }
        ChildMessage::Ack { id } => {
            if let Some(Pending {
                kind: PendingKind::Ack(tx),
            }) = pending.lock().remove(&id)
            {
                let _ = tx.send(());
            }
        }
        ChildMessage::SearchResult { id, hits, error } => {
            if let Some(Pending {
                kind: PendingKind::Search(tx),
            }) = pending.lock().remove(&id)
            {
                if let Some(err) = error {
                    let _ = tx.send(Err(err));
                } else {
                    let _ = tx.send(Ok(hits.unwrap_or_default()));
                }
            }
        }
        ChildMessage::StatusResult { id, status } => {
            if let Some(Pending {
                kind: PendingKind::Status(tx),
            }) = pending.lock().remove(&id)
            {
                let _ = tx.send(status);
            }
        }
        ChildMessage::FlushDone { id } | ChildMessage::ShutdownDone { id } => {
            if let Some(Pending {
                kind: PendingKind::Flush(tx),
            }) = pending.lock().remove(&id)
            {
                let _ = tx.send(());
            }
        }
        ChildMessage::Error { id, message } => {
            eprintln!("[embeddings-host] child error: {message}");
            if let Some(id) = id {
                if let Some(p) = pending.lock().remove(&id) {
                    match p.kind {
                        PendingKind::Ack(tx) => {
                            let _ = tx.send(());
                        }
                        PendingKind::Search(tx) => {
                            let _ = tx.send(Err(message));
                        }
                        PendingKind::Status(tx) => {
                            let _ = tx.send(EmbeddingsIndexStatus {
                                model_available: false,
                                ready: false,
                                model_id: String::new(),
                                indexed_files: 0,
                                pending_files: 0,
                                indexing: false,
                                progress: 0,
                                indexing_enabled: true,
                                error: Some(message),
                            });
                        }
                        PendingKind::Flush(tx) => {
                            let _ = tx.send(());
                        }
                    }
                }
            }
        }
    }
}

fn write_request(stdin: &mut ChildStdin, req: &HostRequest) -> Result<(), String> {
    let line = serde_json::to_string(req).map_err(|e| e.to_string())?;
    writeln!(stdin, "{line}").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

struct SessionCache {
    vault_path: Option<String>,
    app_data: Option<PathBuf>,
    enabled: bool,
    delay_seconds: u32,
    model_dir: Option<PathBuf>,
}

impl Default for SessionCache {
    fn default() -> Self {
        Self {
            vault_path: None,
            app_data: None,
            enabled: true,
            delay_seconds: 5,
            model_dir: None,
        }
    }
}

fn ensure_session(
    session: &mut Option<ChildSession>,
    reader: &mut Option<thread::JoinHandle<()>>,
    pending: &Arc<Mutex<HashMap<u64, Pending>>>,
    app_slot: &Arc<Mutex<Option<AppHandle>>>,
) -> Result<(), String> {
    if let Some(s) = session.as_mut() {
        match s.child.try_wait() {
            Ok(None) => return Ok(()),
            Ok(Some(status)) => {
                eprintln!("[embeddings-host] child exited ({status}); respawning");
                *session = None;
            }
            Err(e) => {
                eprintln!("[embeddings-host] try_wait failed: {e}; respawning");
                *session = None;
            }
        }
    }
    let (s, r) = start_child_io(pending.clone(), app_slot.clone())?;
    *session = Some(s);
    *reader = Some(r);
    Ok(())
}

fn rehydrate(
    session: &mut ChildSession,
    cache: &SessionCache,
    pending: &Arc<Mutex<HashMap<u64, Pending>>>,
    next_id: &AtomicU64,
) {
    let Some(vault) = &cache.vault_path else {
        return;
    };
    let Some(app_data) = &cache.app_data else {
        return;
    };
    let id = next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    pending.lock().insert(
        id,
        Pending {
            kind: PendingKind::Ack(tx),
        },
    );
    let req = HostRequest::OpenVault {
        id,
        vault_path: vault.clone(),
        app_data: app_data.to_string_lossy().to_string(),
        enabled: cache.enabled,
        delay_seconds: cache.delay_seconds,
    };
    if write_request(&mut session.stdin, &req).is_err() {
        pending.lock().remove(&id);
        return;
    }
    let _ = rx.recv_timeout(ACK_TIMEOUT);
    if let Some(dir) = &cache.model_dir {
        let id = next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        pending.lock().insert(
            id,
            Pending {
                kind: PendingKind::Ack(tx),
            },
        );
        let req = HostRequest::ModelAvailable {
            id,
            model_dir: dir.to_string_lossy().to_string(),
        };
        if write_request(&mut session.stdin, &req).is_ok() {
            let _ = rx.recv_timeout(ACK_TIMEOUT);
        } else {
            pending.lock().remove(&id);
        }
    }
}

fn host_loop(rx: Receiver<HostMsg>) {
    let pending: Arc<Mutex<HashMap<u64, Pending>>> = Arc::new(Mutex::new(HashMap::new()));
    let app_slot: Arc<Mutex<Option<AppHandle>>> = Arc::new(Mutex::new(None));
    let next_id = AtomicU64::new(1);
    let mut session: Option<ChildSession> = None;
    let mut reader: Option<thread::JoinHandle<()>> = None;
    let mut cache = SessionCache::default();

    while let Ok(msg) = rx.recv() {
        match msg {
            HostMsg::OpenVault {
                vault_path,
                app_data,
                enabled,
                delay_seconds,
                app,
            } => {
                *app_slot.lock() = Some(app);
                cache.vault_path = Some(vault_path.clone());
                cache.app_data = Some(app_data.clone());
                cache.enabled = enabled;
                cache.delay_seconds = delay_seconds;
                if let Err(e) = ensure_session(&mut session, &mut reader, &pending, &app_slot) {
                    eprintln!("[embeddings-host] {e}");
                    continue;
                }
                let s = session.as_mut().unwrap();
                let id = next_id.fetch_add(1, Ordering::Relaxed);
                let (tx, rx_ack) = mpsc::channel();
                pending.lock().insert(
                    id,
                    Pending {
                        kind: PendingKind::Ack(tx),
                    },
                );
                let req = HostRequest::OpenVault {
                    id,
                    vault_path,
                    app_data: app_data.to_string_lossy().to_string(),
                    enabled,
                    delay_seconds,
                };
                if let Err(e) = write_request(&mut s.stdin, &req) {
                    pending.lock().remove(&id);
                    eprintln!("[embeddings-host] write failed: {e}");
                    session = None;
                    continue;
                }
                let _ = rx_ack.recv_timeout(ACK_TIMEOUT);
            }
            HostMsg::ModelAvailable { model_dir } => {
                cache.model_dir = Some(model_dir.clone());
                if let Err(e) = ensure_session(&mut session, &mut reader, &pending, &app_slot) {
                    eprintln!("[embeddings-host] {e}");
                    continue;
                }
                // If child was respawned empty, rehydrate vault first.
                if cache.vault_path.is_some() {
                    if let Some(s) = session.as_mut() {
                        // Only send modelAvailable; vault should already be open on live child.
                        let id = next_id.fetch_add(1, Ordering::Relaxed);
                        let (tx, rx_ack) = mpsc::channel();
                        pending.lock().insert(
                            id,
                            Pending {
                                kind: PendingKind::Ack(tx),
                            },
                        );
                        let req = HostRequest::ModelAvailable {
                            id,
                            model_dir: model_dir.to_string_lossy().to_string(),
                        };
                        if write_request(&mut s.stdin, &req).is_err() {
                            pending.lock().remove(&id);
                            session = None;
                            if ensure_session(&mut session, &mut reader, &pending, &app_slot).is_ok()
                            {
                                if let Some(s) = session.as_mut() {
                                    rehydrate(s, &cache, &pending, &next_id);
                                }
                            }
                        } else {
                            let _ = rx_ack.recv_timeout(ACK_TIMEOUT);
                        }
                    }
                }
            }
            HostMsg::FileChanged { path } => {
                if let Some(s) = session.as_mut() {
                    let req = HostRequest::FileChanged { path };
                    if write_request(&mut s.stdin, &req).is_err() {
                        session = None;
                    }
                }
            }
            HostMsg::FileRemoved { path } => {
                if let Some(s) = session.as_mut() {
                    let req = HostRequest::FileRemoved { path };
                    if write_request(&mut s.stdin, &req).is_err() {
                        session = None;
                    }
                }
            }
            HostMsg::FileRenamed { from, to } => {
                if let Some(s) = session.as_mut() {
                    let req = HostRequest::FileRenamed { from, to };
                    if write_request(&mut s.stdin, &req).is_err() {
                        session = None;
                    }
                }
            }
            HostMsg::SetPolicy {
                enabled,
                delay_seconds,
                reply,
            } => {
                cache.enabled = enabled;
                cache.delay_seconds = delay_seconds;
                if session.is_none() {
                    let _ = reply.send(());
                    continue;
                }
                if let Err(e) = ensure_session(&mut session, &mut reader, &pending, &app_slot) {
                    eprintln!("[embeddings-host] {e}");
                    let _ = reply.send(());
                    continue;
                }
                let s = session.as_mut().unwrap();
                let id = next_id.fetch_add(1, Ordering::Relaxed);
                pending.lock().insert(
                    id,
                    Pending {
                        kind: PendingKind::Ack(reply),
                    },
                );
                let req = HostRequest::SetPolicy {
                    id,
                    enabled,
                    delay_seconds,
                };
                if write_request(&mut s.stdin, &req).is_err() {
                    if let Some(Pending {
                        kind: PendingKind::Ack(tx),
                    }) = pending.lock().remove(&id)
                    {
                        let _ = tx.send(());
                    }
                }
            }
            HostMsg::Search {
                query,
                limit,
                reply,
            } => {
                if let Err(e) = ensure_session(&mut session, &mut reader, &pending, &app_slot) {
                    let _ = reply.send(Err(e));
                    continue;
                }
                let s = session.as_mut().unwrap();
                let id = next_id.fetch_add(1, Ordering::Relaxed);
                pending.lock().insert(
                    id,
                    Pending {
                        kind: PendingKind::Search(reply),
                    },
                );
                let req = HostRequest::Search { id, query, limit };
                if write_request(&mut s.stdin, &req).is_err() {
                    if let Some(Pending {
                        kind: PendingKind::Search(tx),
                    }) = pending.lock().remove(&id)
                    {
                        let _ = tx.send(Err("Embeddings process write failed".into()));
                    }
                    session = None;
                }
            }
            HostMsg::Status { reply } => {
                if session.is_none() {
                    let _ = reply.send(EmbeddingsIndexStatus {
                        model_available: false,
                        ready: false,
                        model_id: String::new(),
                        indexed_files: 0,
                        pending_files: 0,
                        indexing: false,
                        progress: 0,
                        indexing_enabled: cache.enabled,
                        error: None,
                    });
                    continue;
                }
                if let Err(e) = ensure_session(&mut session, &mut reader, &pending, &app_slot) {
                    let _ = reply.send(EmbeddingsIndexStatus {
                        model_available: false,
                        ready: false,
                        model_id: String::new(),
                        indexed_files: 0,
                        pending_files: 0,
                        indexing: false,
                        progress: 0,
                        indexing_enabled: cache.enabled,
                        error: Some(e),
                    });
                    continue;
                }
                let s = session.as_mut().unwrap();
                let id = next_id.fetch_add(1, Ordering::Relaxed);
                pending.lock().insert(
                    id,
                    Pending {
                        kind: PendingKind::Status(reply),
                    },
                );
                let req = HostRequest::Status { id };
                if write_request(&mut s.stdin, &req).is_err() {
                    if let Some(Pending {
                        kind: PendingKind::Status(tx),
                    }) = pending.lock().remove(&id)
                    {
                        let _ = tx.send(EmbeddingsIndexStatus {
                            model_available: false,
                            ready: false,
                            model_id: String::new(),
                            indexed_files: 0,
                            pending_files: 0,
                            indexing: false,
                            progress: 0,
                            indexing_enabled: cache.enabled,
                            error: Some("Embeddings process write failed".into()),
                        });
                    }
                    session = None;
                }
            }
            HostMsg::Flush { reply } => {
                SHUTTING_DOWN.store(true, Ordering::Relaxed);
                if let Some(s) = session.as_mut() {
                    let id = next_id.fetch_add(1, Ordering::Relaxed);
                    pending.lock().insert(
                        id,
                        Pending {
                            kind: PendingKind::Flush(reply),
                        },
                    );
                    let flush = HostRequest::Flush { id };
                    if write_request(&mut s.stdin, &flush).is_err() {
                        if let Some(Pending {
                            kind: PendingKind::Flush(tx),
                        }) = pending.lock().remove(&id)
                        {
                            let _ = tx.send(());
                        }
                    } else {
                        let shutdown_id = next_id.fetch_add(1, Ordering::Relaxed);
                        let shutdown = HostRequest::Shutdown { id: shutdown_id };
                        let _ = write_request(&mut s.stdin, &shutdown);
                        let _ = s.child.wait_timeout_or_kill(FLUSH_TIMEOUT);
                        // If FlushDone never arrived (killed), unblock caller.
                        if let Some(Pending {
                            kind: PendingKind::Flush(tx),
                        }) = pending.lock().remove(&id)
                        {
                            let _ = tx.send(());
                        }
                    }
                } else {
                    let _ = reply.send(());
                }
            }
        }
    }
}

trait ChildWaitExt {
    fn wait_timeout_or_kill(&mut self, timeout: Duration) -> std::io::Result<()>;
}

impl ChildWaitExt for Child {
    fn wait_timeout_or_kill(&mut self, timeout: Duration) -> std::io::Result<()> {
        let start = std::time::Instant::now();
        loop {
            match self.try_wait()? {
                Some(_) => return Ok(()),
                None if start.elapsed() >= timeout => {
                    let _ = self.kill();
                    let _ = self.wait();
                    return Ok(());
                }
                None => thread::sleep(Duration::from_millis(50)),
            }
        }
    }
}

pub fn start_embeddings_runtime() {
    let rt = runtime();
    let mut guard = rt.tx.lock();
    if guard.is_some() {
        return;
    }
    let (tx, rx) = mpsc::channel::<HostMsg>();
    *guard = Some(tx);
    thread::Builder::new()
        .name("embeddings-host".into())
        .spawn(move || host_loop(rx))
        .expect("spawn embeddings host");
}

pub fn notify_vault_opened(app: &AppHandle, vault_path: &Path) {
    let app_data = match app.path().app_data_dir() {
        Ok(p) => p,
        Err(_) => return,
    };
    let settings = crate::indexing::load_settings(vault_path).unwrap_or_default();
    runtime().send(HostMsg::OpenVault {
        vault_path: vault_path.to_string_lossy().to_string(),
        app_data,
        enabled: settings.enabled,
        delay_seconds: settings.delay_seconds,
        app: app.clone(),
    });
}

pub fn notify_model_available(model_dir: PathBuf) {
    runtime().send(HostMsg::ModelAvailable { model_dir });
}

pub fn notify_indexing_policy(enabled: bool, delay_seconds: u32) {
    let (reply_tx, reply_rx) = mpsc::channel();
    runtime().send(HostMsg::SetPolicy {
        enabled,
        delay_seconds,
        reply: reply_tx,
    });
    let _ = reply_rx.recv_timeout(ACK_TIMEOUT);
}

pub fn flush_index() {
    SHUTTING_DOWN.store(true, Ordering::Relaxed);
    let (reply_tx, reply_rx) = mpsc::channel();
    runtime().send(HostMsg::Flush { reply: reply_tx });
    let _ = reply_rx.recv_timeout(FLUSH_TIMEOUT);
}

pub fn notify_file_changed(path: &str) {
    runtime().send(HostMsg::FileChanged {
        path: path.to_string(),
    });
}

pub fn notify_file_removed(path: &str) {
    runtime().send(HostMsg::FileRemoved {
        path: path.to_string(),
    });
}

pub fn notify_file_renamed(from: &str, to: &str) {
    runtime().send(HostMsg::FileRenamed {
        from: from.to_string(),
        to: to.to_string(),
    });
}

#[tauri::command]
pub async fn semantic_search_notes(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SemanticHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (reply_tx, reply_rx) = mpsc::channel();
        runtime().send(HostMsg::Search {
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
        runtime().send(HostMsg::Status { reply: reply_tx });
        reply_rx
            .recv_timeout(STATUS_TIMEOUT)
            .map_err(|_| "Embeddings status timed out".to_string())
    })
    .await
    .map_err(|e| format!("Embeddings status failed: {e}"))?
}
