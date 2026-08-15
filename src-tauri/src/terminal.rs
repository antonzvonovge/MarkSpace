//! One-shot shell for the agent `run_terminal` tool.
//!
//! cwd is vault-gated via `ensure_inside`. The command string is the only
//! value passed to a shell; env is an allowlist. No PTY / stdin.

use crate::vault::{ensure_inside, get_root, VaultState};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 10 * 60 * 1_000;
const MAX_OUTPUT_BYTES: usize = 200_000;
const MAX_JOBS: usize = 4;
const MAX_COMMAND_CHARS: usize = 32_768;

pub struct TerminalRuntime {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
}

impl Default for TerminalRuntime {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }
}

struct Job {
    pid: u32,
    child: Mutex<Option<Child>>,
}


#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunTerminalResponse {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub cwd: String,
    pub timed_out: bool,
    pub truncated: bool,
    pub killed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub(crate) fn clamp_timeout_ms(value: Option<u64>) -> u64 {
    value.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
}

pub(crate) fn allowed_env_key(key: &str) -> bool {
    let k = key.to_ascii_uppercase();
    matches!(
        k.as_str(),
        "PATH"
            | "HOME"
            | "USERPROFILE"
            | "HOMEDRIVE"
            | "HOMEPATH"
            | "USER"
            | "USERNAME"
            | "LOGNAME"
            | "LANG"
            | "TERM"
            | "TMPDIR"
            | "TEMP"
            | "TMP"
            | "SHELL"
            | "COMSPEC"
            | "SYSTEMROOT"
            | "WINDIR"
            | "PATHEXT"
    ) || k.starts_with("LC_")
}

fn cwd_rel_shown(rel: &str) -> String {
    rel.trim().trim_start_matches('/').replace('\\', "/")
}

/// Resolve a vault-relative cwd. Empty path → vault root.
pub(crate) fn resolve_terminal_cwd(root: &Path, cwd: &str) -> Result<(PathBuf, String), String> {
    let rel = cwd_rel_shown(cwd);
    if rel.contains('\0') {
        return Err("Invalid cwd".into());
    }
    let candidate = if rel.is_empty() {
        root.to_path_buf()
    } else {
        PathBuf::from(&rel)
    };
    let full = ensure_inside(root, &candidate)?;
    if !full.exists() {
        return Err("cwd does not exist".into());
    }
    if !full.is_dir() {
        return Err("cwd is not a directory".into());
    }
    Ok((full, rel))
}

fn validate_command(command: &str) -> Result<&str, String> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return Err("Command is empty".into());
    }
    if cmd.contains('\0') {
        return Err("Invalid command".into());
    }
    if cmd.chars().count() > MAX_COMMAND_CHARS {
        return Err("Command is too long".into());
    }
    Ok(cmd)
}

fn apply_env(cmd: &mut Command) {
    cmd.env_clear();
    for (key, value) in std::env::vars() {
        if allowed_env_key(&key) {
            cmd.env(key, value);
        }
    }
    cmd.env("TERM", "dumb");
}

fn spawn_shell(command: &str, cwd: &Path) -> Result<Child, String> {
    let mut cmd = {
        #[cfg(windows)]
        {
            let mut c = Command::new("cmd.exe");
            c.arg("/C").arg(command);
            c
        }
        #[cfg(not(windows))]
        {
            let mut c = Command::new("/bin/sh");
            c.arg("-c").arg(command);
            c
        }
    };
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_env(&mut cmd);

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }

    cmd.spawn().map_err(|e| format!("Failed to start command: {e}"))
}

fn kill_process_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn read_capped(mut reader: impl Read, cap: usize) -> (Vec<u8>, bool) {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                if buf.len() < cap {
                    let room = cap - buf.len();
                    let take = n.min(room);
                    buf.extend_from_slice(&tmp[..take]);
                    if n > room {
                        truncated = true;
                    }
                } else {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (buf, truncated)
}

fn bytes_to_text(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).into_owned()
}

fn take_job(runtime: &TerminalRuntime, job_id: &str) -> Option<Arc<Job>> {
    runtime.jobs.lock().remove(job_id)
}

fn kill_job(job: &Job) {
    kill_process_tree(job.pid);
    if let Some(mut child) = job.child.lock().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
pub fn run_terminal_command(
    job_id: String,
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    vault: State<'_, VaultState>,
    runtime: State<'_, TerminalRuntime>,
) -> Result<RunTerminalResponse, String> {
    let job_id = job_id.trim();
    if job_id.is_empty() {
        return Err("jobId required".into());
    }
    let command = validate_command(&command)?.to_string();
    let root = get_root(&vault)?;
    let (cwd_abs, cwd_rel) = resolve_terminal_cwd(&root, cwd.as_deref().unwrap_or(""))?;
    let timeout = Duration::from_millis(clamp_timeout_ms(timeout_ms));

    {
        let jobs = runtime.jobs.lock();
        if jobs.len() >= MAX_JOBS {
            return Err(format!("Too many terminal jobs (max {MAX_JOBS})"));
        }
        if jobs.contains_key(job_id) {
            return Err("A terminal job with this id is already running".into());
        }
    }

    let mut child = spawn_shell(&command, &cwd_abs)?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pid = child.id();
    let job = Arc::new(Job {
        pid,
        child: Mutex::new(Some(child)),
    });
    runtime.jobs.lock().insert(job_id.to_string(), Arc::clone(&job));

    let stdout_handle = thread::spawn(move || match stdout {
        Some(pipe) => read_capped(pipe, MAX_OUTPUT_BYTES),
        None => (Vec::new(), false),
    });
    let stderr_handle = thread::spawn(move || match stderr {
        Some(pipe) => read_capped(pipe, MAX_OUTPUT_BYTES),
        None => (Vec::new(), false),
    });

    let started = Instant::now();
    let mut timed_out = false;
    let mut killed = false;
    let mut exit_code: Option<i32> = None;
    let mut wait_error: Option<String> = None;

    loop {
        if started.elapsed() >= timeout {
            timed_out = true;
            kill_job(&job);
            break;
        }
        let mut guard = job.child.lock();
        match guard.as_mut() {
            None => {
                killed = true;
                break;
            }
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => {
                    exit_code = status.code();
                    *guard = None;
                    break;
                }
                Ok(None) => {}
                Err(e) => {
                    wait_error = Some(format!("Failed to wait for command: {e}"));
                    *guard = None;
                    break;
                }
            },
        }
        drop(guard);
        thread::sleep(Duration::from_millis(40));
    }

    take_job(&runtime, job_id);

    let (stdout_bytes, stdout_trunc) = stdout_handle.join().unwrap_or_else(|_| (Vec::new(), false));
    let (stderr_bytes, stderr_trunc) = stderr_handle.join().unwrap_or_else(|_| (Vec::new(), false));
    let truncated = stdout_trunc || stderr_trunc;

    if let Some(error) = wait_error {
        return Ok(RunTerminalResponse {
            ok: false,
            exit_code: None,
            stdout: bytes_to_text(stdout_bytes),
            stderr: bytes_to_text(stderr_bytes),
            cwd: cwd_rel,
            timed_out,
            truncated,
            killed,
            error: Some(error),
        });
    }

    let ok = !timed_out && !killed && exit_code == Some(0);
    Ok(RunTerminalResponse {
        ok,
        exit_code,
        stdout: bytes_to_text(stdout_bytes),
        stderr: bytes_to_text(stderr_bytes),
        cwd: cwd_rel,
        timed_out,
        truncated,
        killed,
        error: if timed_out {
            Some("Command timed out".into())
        } else if killed {
            Some("Command was stopped".into())
        } else {
            None
        },
    })
}

#[tauri::command]
pub fn kill_terminal_command(
    job_id: String,
    runtime: State<'_, TerminalRuntime>,
) -> Result<bool, String> {
    let id = job_id.trim();
    if id.is_empty() {
        return Err("jobId required".into());
    }
    let Some(job) = runtime.jobs.lock().get(id).cloned() else {
        return Ok(false);
    };
    kill_job(&job);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_vault(name: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "markspace-terminal-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn cwd_empty_is_vault_root() {
        let root = temp_vault("empty");
        let (full, rel) = resolve_terminal_cwd(&root, "").unwrap();
        assert_eq!(rel, "");
        assert_eq!(full.canonicalize().unwrap(), root.canonicalize().unwrap());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cwd_nested_folder_inside_vault() {
        let root = temp_vault("nested");
        fs::create_dir_all(root.join("proj/sub")).unwrap();
        let (full, rel) = resolve_terminal_cwd(&root, "proj/sub").unwrap();
        assert_eq!(rel, "proj/sub");
        assert_eq!(
            full.canonicalize().unwrap(),
            root.join("proj/sub").canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cwd_parent_dir_escapes() {
        let root = temp_vault("escape");
        let err = resolve_terminal_cwd(&root, "../secret").unwrap_err();
        assert!(err.to_lowercase().contains("escape"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cwd_dotdot_chain_escapes() {
        let root = temp_vault("dotdot");
        fs::create_dir_all(root.join("proj")).unwrap();
        let err = resolve_terminal_cwd(&root, "proj/../../secret").unwrap_err();
        assert!(err.to_lowercase().contains("escape"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn env_allowlist_keeps_path_drops_secrets() {
        assert!(allowed_env_key("PATH"));
        assert!(allowed_env_key("Home"));
        assert!(allowed_env_key("LC_ALL"));
        assert!(!allowed_env_key("OPENAI_API_KEY"));
        assert!(!allowed_env_key("ANTHROPIC_API_KEY"));
        assert!(!allowed_env_key("FIRECRAWL_API_KEY"));
        assert!(!allowed_env_key("SSH_AUTH_SOCK"));
        assert!(!allowed_env_key("AWS_SECRET_ACCESS_KEY"));
    }

    #[test]
    fn timeout_clamp() {
        assert_eq!(clamp_timeout_ms(None), DEFAULT_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(Some(0)), MIN_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(Some(99_999_999)), MAX_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(Some(5_000)), 5_000);
    }

    #[test]
    fn empty_command_rejected() {
        assert!(validate_command("").is_err());
        assert!(validate_command("   ").is_err());
        assert!(validate_command("echo hi").is_ok());
    }
}
