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
use crate::indexing::BackgroundPriority;

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
        priority: BackgroundPriority,
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
        priority: BackgroundPriority,
        reply: Sender<()>,
    },
    UserActivity,
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
    /// Threads and `nice` are fixed at spawn, so a policy change needs a respawn.
    priority: BackgroundPriority,
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
        // Skip missing paths and zero-byte Tauri stubs from build.rs / stage script.
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.is_file() && meta.len() > 0 {
                return Ok(path);
            }
        }
    }
    Err(format!(
        "markspace-embeddings binary not found (run `npm run sidecar:stage`). Tried: {}",
        sidecar_candidates()
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Worker threads for the sidecar, or `None` to leave the defaults alone.
///
/// `RAYON_NUM_THREADS` is the sanctioned knob: `candle_core::utils::get_num_threads`
/// reads it and the CPU backend turns it into `Parallelism::Rayon(n)` (or
/// `Parallelism::None` at 1). Left unset, Candle 0.8 takes every logical core.
/// MiniLM-sized models gain little from wide parallelism, so we stay low and
/// leave the WebView room to paint. `MARKSPACE_EMBED_THREADS` overrides it for
/// benchmarking without a rebuild.
fn embed_threads(priority: BackgroundPriority) -> Option<usize> {
    if let Ok(raw) = std::env::var("MARKSPACE_EMBED_THREADS") {
        if let Ok(n) = raw.trim().parse::<usize>() {
            if n > 0 {
                return Some(n);
            }
        }
    }
    match priority {
        BackgroundPriority::Low => Some(1),
        BackgroundPriority::Balanced => {
            let cores = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4);
            Some((cores / 8).clamp(1, 2))
        }
        BackgroundPriority::Full => None,
    }
}

/// Niceness increment for the child, or 0 to inherit ours.
///
/// Deliberately gentle: a steeper `nice` starves the sidecar badly enough that
/// indexing never finishes on a busy machine.
fn nice_increment(priority: BackgroundPriority) -> i32 {
    match priority {
        BackgroundPriority::Low => 10,
        BackgroundPriority::Balanced => 5,
        BackgroundPriority::Full => 0,
    }
}

fn start_child_io(
    pending: Arc<Mutex<HashMap<u64, Pending>>>,
    app_slot: Arc<Mutex<Option<AppHandle>>>,
    priority: BackgroundPriority,
) -> Result<(ChildSession, thread::JoinHandle<()>), String> {
    let path = resolve_sidecar_path()?;
    let mut cmd = Command::new(&path);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    if let Some(threads) = embed_threads(priority) {
        let value = threads.to_string();
        cmd.env("RAYON_NUM_THREADS", &value);
        // Only bites if we ever build with the `mkl` feature, harmless otherwise.
        cmd.env("OMP_NUM_THREADS", &value);
    }
    cmd.env("TOKENIZERS_PARALLELISM", "false");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // Not PROCESS_MODE_BACKGROUND_BEGIN: it only accepts the current process
        // as a target, and it permanently trims the working set, which trades CPU
        // priority for a storm of page faults.
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        let mut flags = CREATE_NO_WINDOW;
        if nice_increment(priority) > 0 {
            flags |= BELOW_NORMAL_PRIORITY_CLASS;
        }
        cmd.creation_flags(flags);
    }
    #[cfg(unix)]
    {
        let increment = nice_increment(priority);
        if increment > 0 {
            use std::os::unix::process::CommandExt;
            // `setpriority` is async-signal-safe, so it is legal in `pre_exec`.
            // It has to happen here rather than later: an unprivileged process
            // cannot lower its own niceness again once raised.
            unsafe {
                cmd.pre_exec(move || {
                    libc::setpriority(libc::PRIO_PROCESS, 0, increment);
                    Ok(())
                });
            }
        }
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

    Ok((
        ChildSession {
            child,
            stdin,
            priority,
        },
        reader,
    ))
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
    priority: BackgroundPriority,
    model_dir: Option<PathBuf>,
}

impl Default for SessionCache {
    fn default() -> Self {
        Self {
            vault_path: None,
            app_data: None,
            enabled: true,
            delay_seconds: 5,
            priority: BackgroundPriority::default(),
            model_dir: None,
        }
    }
}

/// Returns true when a fresh child was spawned, so the caller knows it has to
/// rehydrate the vault before the child is useful.
fn ensure_session(
    session: &mut Option<ChildSession>,
    reader: &mut Option<thread::JoinHandle<()>>,
    pending: &Arc<Mutex<HashMap<u64, Pending>>>,
    app_slot: &Arc<Mutex<Option<AppHandle>>>,
    priority: BackgroundPriority,
) -> Result<bool, String> {
    if let Some(s) = session.as_mut() {
        if s.priority != priority {
            eprintln!("[embeddings-host] priority changed; respawning child");
            let _ = s.child.kill();
            let _ = s.child.wait();
            *session = None;
        } else {
            match s.child.try_wait() {
                Ok(None) => return Ok(false),
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
    }
    let (s, r) = start_child_io(pending.clone(), app_slot.clone(), priority)?;
    *session = Some(s);
    *reader = Some(r);
    Ok(true)
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
        pause_on_activity: cache.priority.pauses_on_activity(),
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
                priority,
                app,
            } => {
                *app_slot.lock() = Some(app);
                cache.vault_path = Some(vault_path.clone());
                cache.app_data = Some(app_data.clone());
                cache.enabled = enabled;
                cache.delay_seconds = delay_seconds;
                cache.priority = priority;
                if let Err(e) =
                    ensure_session(&mut session, &mut reader, &pending, &app_slot, priority)
                {
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
                    pause_on_activity: priority.pauses_on_activity(),
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
                if let Err(e) =
                    ensure_session(&mut session, &mut reader, &pending, &app_slot, cache.priority)
                {
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
                            if ensure_session(
                                &mut session,
                                &mut reader,
                                &pending,
                                &app_slot,
                                cache.priority,
                            )
                            .is_ok()
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
                priority,
                reply,
            } => {
                cache.enabled = enabled;
                cache.delay_seconds = delay_seconds;
                cache.priority = priority;
                if session.is_none() {
                    let _ = reply.send(());
                    continue;
                }
                let respawned =
                    match ensure_session(&mut session, &mut reader, &pending, &app_slot, priority) {
                        Ok(v) => v,
                        Err(e) => {
                            eprintln!("[embeddings-host] {e}");
                            let _ = reply.send(());
                            continue;
                        }
                    };
                let s = session.as_mut().unwrap();
                if respawned {
                    // A fresh child needs the vault back; the OpenVault it gets
                    // already carries the new policy, so skip SetPolicy.
                    rehydrate(s, &cache, &pending, &next_id);
                    let _ = reply.send(());
                    continue;
                }
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
                    pause_on_activity: priority.pauses_on_activity(),
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
            HostMsg::UserActivity => {
                // Best effort: never spawn a child just to say the user is busy,
                // and never block. A dropped heartbeat only costs one 100ms tick.
                if let Some(s) = session.as_mut() {
                    if write_request(&mut s.stdin, &HostRequest::UserActivity).is_err() {
                        session = None;
                    }
                }
            }
            HostMsg::Search {
                query,
                limit,
                reply,
            } => {
                let respawned = match ensure_session(
                    &mut session,
                    &mut reader,
                    &pending,
                    &app_slot,
                    cache.priority,
                ) {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = reply.send(Err(e));
                        continue;
                    }
                };
                let s = session.as_mut().unwrap();
                if respawned {
                    rehydrate(s, &cache, &pending, &next_id);
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
                let respawned = match ensure_session(
                    &mut session,
                    &mut reader,
                    &pending,
                    &app_slot,
                    cache.priority,
                ) {
                    Ok(v) => v,
                    Err(e) => {
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
                };
                if respawned {
                    let s = session.as_mut().unwrap();
                    rehydrate(s, &cache, &pending, &next_id);
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
    let settings = crate::indexing::load_for_vault(&app_data, vault_path);
    runtime().send(HostMsg::OpenVault {
        vault_path: vault_path.to_string_lossy().to_string(),
        app_data,
        enabled: settings.enabled,
        delay_seconds: settings.delay_seconds,
        priority: settings.background_priority,
        app: app.clone(),
    });
}

pub fn notify_model_available(model_dir: PathBuf) {
    runtime().send(HostMsg::ModelAvailable { model_dir });
}

pub fn notify_indexing_policy(
    enabled: bool,
    delay_seconds: u32,
    priority: BackgroundPriority,
) {
    let (reply_tx, reply_rx) = mpsc::channel();
    runtime().send(HostMsg::SetPolicy {
        enabled,
        delay_seconds,
        priority,
        reply: reply_tx,
    });
    let _ = reply_rx.recv_timeout(ACK_TIMEOUT);
}

/// Heartbeat from the UI: the user is typing or a chat stream is running.
///
/// Throttled to roughly once a second by the frontend, and the sidecar expires
/// it after a few seconds, so no matching "user is idle" call is needed.
#[tauri::command]
pub fn notify_user_activity() {
    runtime().send(HostMsg::UserActivity);
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
