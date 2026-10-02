//! Scheduled routines stored in `{vault}/.markspace/routines/<id>.json`.
//!
//! The tick lives here, not in the webview. It emits `routine-run` only when a
//! run starts or finishes. An agent routine holds `running` until the webview
//! calls `complete_routine_run`. A command routine runs the shell here and
//! writes the report itself.

use crate::terminal::{self, TerminalRuntime};
use crate::vault::{get_root, VaultState};
use chrono::{DateTime, Local, TimeZone};
use cron::Schedule;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

const MAX_NAME_CHARS: usize = 80;
const ROUTINES_ROOT: &str = "Routines";
const TICK: Duration = Duration::from_secs(30);
const MAX_REPORT_CHARS: usize = 200_000;
const MAX_KEPT_RUNS: usize = 20;
const BRIEF_ATTACHMENTS_DIR: &str = ".brief-attachments";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunTrigger {
    Schedule,
    Manual,
    Catchup,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoutineRun {
    pub at: String,
    pub trigger: RunTrigger,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Routine {
    pub id: String,
    pub name: String,
    /// App-local. Not written into the vault file. Missing means off.
    #[serde(default)]
    pub enabled: bool,
    pub cron: String,
    /// Vault-relative job folder, `Routines/<name>`.
    #[serde(default)]
    pub folder: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    /// Legacy journal. Read once, written out as markdown, then dropped.
    #[serde(default, skip_serializing)]
    pub runs: Vec<RoutineRun>,
    /// Composer draft (same serialization as the chat composer).
    #[serde(default)]
    pub brief: String,
    #[serde(default)]
    pub project_path: String,
    /// `ask` or `agent`. Empty means agent.
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub model_id: String,
    /// `off`, `auto`, or `on`. Empty means auto.
    #[serde(default)]
    pub reasoning_mode: String,
    #[serde(default)]
    pub specialist_model_id: String,
    #[serde(default)]
    pub specialists_use_chat_model: bool,
    #[serde(default)]
    pub attachments: Vec<RoutineAttachmentRef>,
    /// `command` runs a shell command. Empty or `agent` runs the brief.
    #[serde(default)]
    pub kind: String,
    /// Shell command for `kind = command`.
    #[serde(default)]
    pub command: String,
    /// Vault-relative working directory. Empty is the vault root.
    #[serde(default)]
    pub command_cwd: String,
    /// `0` means 60 seconds. Otherwise clamped to the terminal limits.
    #[serde(default)]
    pub command_timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoutineRunFile {
    pub path: String,
    pub at: String,
    pub trigger: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoutineAttachmentRef {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub kind: String,
    /// Vault-relative file inside `{folder}/.brief-attachments/`.
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSnapshot {
    pub routines: Vec<Routine>,
    pub running_id: Option<String>,
    pub epoch: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutineRunEvent {
    id: String,
    phase: String,
    epoch: u64,
    /// `command` or `agent`. The webview starts Grisha only for `agent`.
    kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertRoutineArgs {
    pub id: Option<String>,
    pub name: String,
    pub cron: String,
    /// `None` keeps the stored value. `Some("")` clears it.
    #[serde(default)]
    pub brief: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub reasoning_mode: Option<String>,
    #[serde(default)]
    pub specialist_model_id: Option<String>,
    #[serde(default)]
    pub specialists_use_chat_model: Option<bool>,
    #[serde(default)]
    pub attachments: Option<Vec<RoutineAttachmentRef>>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub command_cwd: Option<String>,
    #[serde(default)]
    pub command_timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRoutineRunArgs {
    pub id: String,
    pub epoch: u64,
    pub status: String,
    pub body: String,
}

struct RunOutcome {
    status: String,
    body: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PendingRun {
    id: String,
    trigger: RunTrigger,
}

#[derive(Debug, Default)]
struct RunGate {
    running: Option<PendingRun>,
    queued: VecDeque<PendingRun>,
}

impl RunGate {
    /// Starts `job` immediately, or queues it while another run is in progress.
    /// Returns true only when this job became the running one.
    fn try_begin(&mut self, job: PendingRun) -> bool {
        if self.running.as_ref().is_some_and(|run| run.id == job.id) {
            return false;
        }
        if self.queued.iter().any(|run| run.id == job.id) {
            return false;
        }
        if self.running.is_some() {
            self.queued.push_back(job);
            return false;
        }
        self.running = Some(job);
        true
    }

    /// Ends the current run and promotes the next queued job.
    fn finish(&mut self) -> Option<PendingRun> {
        self.running = None;
        let next = self.queued.pop_front()?;
        self.running = Some(next.clone());
        Some(next)
    }

    fn clear(&mut self) {
        self.running = None;
        self.queued.clear();
    }
}

enum WorkerMsg {
    RunNow(String),
}

struct RoutinesRuntime {
    io: Mutex<()>,
    tx: Mutex<Option<mpsc::UnboundedSender<WorkerMsg>>>,
    cancel: Mutex<Option<CancellationToken>>,
    epoch: AtomicU64,
    running: Mutex<Option<(u64, String)>>,
    completions: Mutex<HashMap<(u64, String), oneshot::Sender<RunOutcome>>>,
}

impl RoutinesRuntime {
    fn new() -> Self {
        Self {
            io: Mutex::new(()),
            tx: Mutex::new(None),
            cancel: Mutex::new(None),
            epoch: AtomicU64::new(0),
            running: Mutex::new(None),
            completions: Mutex::new(HashMap::new()),
        }
    }

    fn bump_epoch(&self) -> u64 {
        let epoch = self.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        *self.running.lock() = None;
        self.completions.lock().clear();
        epoch
    }

    fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }

    fn set_running(&self, epoch: u64, id: Option<String>) {
        if self.epoch() != epoch {
            return;
        }
        *self.running.lock() = id.map(|id| (epoch, id));
    }

    fn running_id(&self, epoch: u64) -> Option<String> {
        self.running
            .lock()
            .clone()
            .filter(|(running_epoch, _)| *running_epoch == epoch)
            .map(|(_, id)| id)
    }
}

fn runtime() -> &'static RoutinesRuntime {
    static RT: OnceLock<RoutinesRuntime> = OnceLock::new();
    RT.get_or_init(RoutinesRuntime::new)
}

pub fn on_vault_opened(app: AppHandle, root: PathBuf) {
    let rt = runtime();
    if let Some(token) = rt.cancel.lock().take() {
        token.cancel();
    }
    let epoch = rt.bump_epoch();
    let token = CancellationToken::new();
    let (tx, rx) = mpsc::unbounded_channel();
    *rt.tx.lock() = Some(tx);
    *rt.cancel.lock() = Some(token.clone());
    tauri::async_runtime::spawn(async move {
        worker(app, root, epoch, token, rx).await;
    });
}

async fn worker(
    app: AppHandle,
    root: PathBuf,
    epoch: u64,
    cancel: CancellationToken,
    mut rx: mpsc::UnboundedReceiver<WorkerMsg>,
) {
    let mut gate = RunGate::default();
    let mut ticker = interval(TICK);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    // `interval` fires immediately; consume that tick so open does not double-fire.
    ticker.tick().await;

    if !cancel.is_cancelled() {
        if let Ok(due) = claim_locked(&app, &root, Local::now(), RunTrigger::Catchup) {
            drive(&app, &root, epoch, &cancel, &mut gate, due).await;
        }
    }

    loop {
        if cancel.is_cancelled() || runtime().epoch() != epoch {
            break;
        }
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = ticker.tick() => {
                if let Ok(due) = claim_locked(&app, &root, Local::now(), RunTrigger::Schedule) {
                    drive(&app, &root, epoch, &cancel, &mut gate, due).await;
                }
            }
            msg = rx.recv() => {
                let Some(msg) = msg else { break };
                match msg {
                    WorkerMsg::RunNow(id) => {
                        drive(
                            &app,
                            &root,
                            epoch,
                            &cancel,
                            &mut gate,
                            vec![PendingRun { id, trigger: RunTrigger::Manual }],
                        )
                        .await;
                    }
                }
            }
        }
    }
    gate.clear();
    runtime().set_running(epoch, None);
}

fn claim_locked(
    app: &AppHandle,
    root: &Path,
    now: DateTime<Local>,
    trigger: RunTrigger,
) -> Result<Vec<PendingRun>, String> {
    let _io = runtime().io.lock();
    let enabled = load_enabled_ids(app, root);
    claim_due(root, now, trigger, &enabled)
}

async fn drive(
    app: &AppHandle,
    root: &Path,
    epoch: u64,
    cancel: &CancellationToken,
    gate: &mut RunGate,
    incoming: Vec<PendingRun>,
) {
    for job in incoming {
        gate.try_begin(job);
    }
    while gate.running.is_some() {
        if cancel.is_cancelled() || runtime().epoch() != epoch {
            gate.clear();
            runtime().set_running(epoch, None);
            return;
        }
        let job = gate.running.clone().expect("running");
        if routine_is_command(root, &job.id) {
            execute_command(app, root, epoch, cancel, &job).await;
        } else {
            execute_agent(app, root, epoch, cancel, &job).await;
        }
        if cancel.is_cancelled() || runtime().epoch() != epoch {
            gate.clear();
            runtime().set_running(epoch, None);
            return;
        }
        if gate.finish().is_none() {
            break;
        }
    }
}

async fn execute_agent(
    app: &AppHandle,
    root: &Path,
    epoch: u64,
    cancel: &CancellationToken,
    job: &PendingRun,
) {
    if cancel.is_cancelled() || runtime().epoch() != epoch {
        return;
    }
    runtime().set_running(epoch, Some(job.id.clone()));
    let (tx, rx) = oneshot::channel();
    runtime()
        .completions
        .lock()
        .insert((epoch, job.id.clone()), tx);
    let _ = app.emit(
        "routine-run",
        RoutineRunEvent {
            id: job.id.clone(),
            phase: "started".into(),
            epoch,
            kind: "agent".into(),
        },
    );

    let outcome = tokio::select! {
        _ = cancel.cancelled() => None,
        result = rx => result.ok(),
    };
    runtime()
        .completions
        .lock()
        .remove(&(epoch, job.id.clone()));

    if runtime().epoch() != epoch {
        return;
    }

    if let Some(outcome) = outcome {
        let _io = runtime().io.lock();
        if let Err(err) = append_run_report(
            root,
            &job.id,
            job.trigger,
            Local::now(),
            &outcome.status,
            &outcome.body,
        ) {
            eprintln!("routine run {id}: {err}", id = job.id);
        }
    }

    runtime().set_running(epoch, None);
    if runtime().epoch() == epoch {
        let _ = app.emit(
            "routine-run",
            RoutineRunEvent {
                id: job.id.clone(),
                phase: "finished".into(),
                epoch,
                kind: "agent".into(),
            },
        );
    }
}

fn routine_is_command(root: &Path, id: &str) -> bool {
    let _io = runtime().io.lock();
    read_routine(root, id)
        .map(|doc| is_command_kind(&doc.kind))
        .unwrap_or(false)
}

fn is_command_kind(kind: &str) -> bool {
    kind.trim() == "command"
}

const WIDGET_OPEN: &str = "<!-- widget -->";
const WIDGET_CLOSE: &str = "<!-- /widget -->";

fn last_closed_widget_block(text: &str) -> Option<String> {
    let mut search_end = text.len();
    while search_end > 0 {
        let head = &text[..search_end];
        let Some(close_at) = head.rfind(WIDGET_CLOSE) else {
            return None;
        };
        if let Some(open_at) = head[..close_at].rfind(WIDGET_OPEN) {
            let body = text[open_at + WIDGET_OPEN.len()..close_at].trim();
            if !body.is_empty() {
                return Some(body.to_string());
            }
        }
        search_end = close_at;
    }
    None
}

/// Card text for a command run. A closed widget block wins. Otherwise stdout.
/// A failed run with empty stdout uses stderr, then `reason`.
fn command_card_body(stdout: &str, stderr: &str, failed: bool, reason: &str) -> String {
    if let Some(block) = last_closed_widget_block(stdout) {
        return block;
    }
    let stdout = stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }
    if !failed {
        return String::new();
    }
    let stderr = stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    reason.trim().to_string()
}

struct CommandReport {
    status: String,
    body: String,
    command: String,
    cwd_label: String,
    exit_label: String,
}

fn cwd_label(rel: &str) -> String {
    let rel = rel.trim().trim_start_matches('/');
    if rel.is_empty() {
        "vault root".into()
    } else {
        rel.to_string()
    }
}

fn exit_label(exit_code: Option<i32>, timed_out: bool, killed: bool) -> String {
    if timed_out {
        return "timed out".into();
    }
    if killed {
        return "stopped".into();
    }
    match exit_code {
        Some(code) => code.to_string(),
        None => "-".into(),
    }
}

fn failed_without_process(command: &str, cwd: &str, body: &str) -> CommandReport {
    CommandReport {
        status: "failed".into(),
        body: body.to_string(),
        command: command.to_string(),
        cwd_label: cwd_label(cwd),
        exit_label: "-".into(),
    }
}

fn report_from_shell(
    command: &str,
    cwd: &str,
    response: &terminal::RunTerminalResponse,
) -> CommandReport {
    let failed = !response.ok;
    let reason = response.error.clone().unwrap_or_default();
    CommandReport {
        status: if failed { "failed" } else { "done" }.into(),
        body: command_card_body(&response.stdout, &response.stderr, failed, &reason),
        command: command.to_string(),
        cwd_label: cwd_label(if response.cwd.is_empty() { cwd } else { &response.cwd }),
        exit_label: exit_label(response.exit_code, response.timed_out, response.killed),
    }
}

fn command_timeout(ms: u64) -> Duration {
    Duration::from_millis(if ms == 0 {
        terminal::clamp_timeout_ms(None)
    } else {
        terminal::clamp_timeout_ms(Some(ms))
    })
}

async fn execute_command(
    app: &AppHandle,
    root: &Path,
    epoch: u64,
    cancel: &CancellationToken,
    job: &PendingRun,
) {
    if cancel.is_cancelled() || runtime().epoch() != epoch {
        return;
    }
    let doc = {
        let _io = runtime().io.lock();
        match read_routine(root, &job.id) {
            Ok(doc) => doc,
            Err(err) => {
                eprintln!("routine run {id}: {err}", id = job.id);
                return;
            }
        }
    };
    runtime().set_running(epoch, Some(job.id.clone()));
    let _ = app.emit(
        "routine-run",
        RoutineRunEvent {
            id: job.id.clone(),
            phase: "started".into(),
            epoch,
            kind: "command".into(),
        },
    );

    let outcome = if cancel.is_cancelled() || runtime().epoch() != epoch {
        None
    } else {
        run_command_shell(app, root, cancel, &doc).await
    };

    if runtime().epoch() != epoch {
        return;
    }

    if let Some(report) = outcome {
        let _io = runtime().io.lock();
        if let Err(err) = append_command_report(
            root,
            &job.id,
            job.trigger,
            Local::now(),
            &report,
        ) {
            eprintln!("routine run {id}: {err}", id = job.id);
        }
    }

    runtime().set_running(epoch, None);
    if runtime().epoch() == epoch {
        let _ = app.emit(
            "routine-run",
            RoutineRunEvent {
                id: job.id.clone(),
                phase: "finished".into(),
                epoch,
                kind: "command".into(),
            },
        );
    }
}

async fn run_command_shell(
    app: &AppHandle,
    root: &Path,
    cancel: &CancellationToken,
    doc: &Routine,
) -> Option<CommandReport> {
    let command = doc.command.trim();
    if command.is_empty() {
        return Some(failed_without_process(
            &doc.command,
            &doc.command_cwd,
            "Command is empty",
        ));
    }
    let (cwd_abs, cwd_rel) = match terminal::resolve_terminal_cwd(root, &doc.command_cwd) {
        Ok(pair) => pair,
        Err(err) => {
            return Some(failed_without_process(&doc.command, &doc.command_cwd, &err));
        }
    };
    let timeout = command_timeout(doc.command_timeout_ms);
    let job_id = format!("routine-{}", doc.id);
    let app_run = app.clone();
    let job_id_run = job_id.clone();
    let command_owned = command.to_string();
    let cwd_rel_run = cwd_rel.clone();
    let mut join = tokio::task::spawn_blocking(move || {
        let shell = app_run.state::<TerminalRuntime>();
        terminal::run_shell(
            &shell,
            &job_id_run,
            &command_owned,
            &cwd_abs,
            &cwd_rel_run,
            timeout,
        )
    });
    let command_for_report = doc.command.clone();
    let waited = tokio::select! {
        _ = cancel.cancelled() => None,
        result = &mut join => Some(result),
    };
    let Some(result) = waited else {
        let shell = app.state::<TerminalRuntime>();
        terminal::kill_shell_job(&shell, &job_id);
        let _ = join.await;
        return None;
    };
    Some(match result {
        Ok(Ok(response)) => report_from_shell(&command_for_report, &cwd_rel, &response),
        Ok(Err(err)) => failed_without_process(&command_for_report, &cwd_rel, &err),
        Err(err) => failed_without_process(&command_for_report, &cwd_rel, &err.to_string()),
    })
}

fn routines_dir(root: &Path) -> PathBuf {
    root.join(".markspace").join("routines")
}

fn routine_path(root: &Path, id: &str) -> PathBuf {
    routines_dir(root).join(format!("{id}.json"))
}

fn validate_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        Ok(())
    } else {
        Err("Invalid routine id".into())
    }
}

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos:x}{n:x}")
}

fn parse_cron(expr: &str) -> Result<Schedule, String> {
    let trimmed = expr.trim();
    let fields: Vec<&str> = trimmed.split_whitespace().collect();
    if fields.len() != 5 {
        return Err("Cron must have 5 fields: minute hour day month weekday".into());
    }
    // crontab numbers Sunday as 0 or 7. The cron crate numbers Sunday as 1.
    let dow = translate_dow_field(fields[4])?;
    let cron = format!(
        "0 {} {} {} {} {dow}",
        fields[0], fields[1], fields[2], fields[3]
    );
    Schedule::from_str(&cron).map_err(|err| format!("Invalid cron: {err}"))
}

/// Standard 5-field weekday → crate ordinals (1 = Sunday … 7 = Saturday).
fn translate_dow_field(field: &str) -> Result<String, String> {
    let field = field.trim();
    if field == "*" || field == "?" {
        return Ok("*".into());
    }
    let mut days = BTreeSet::new();
    for part in field.split(',') {
        expand_dow_part(part.trim(), &mut days)?;
    }
    if days.is_empty() {
        return Err("Invalid cron: empty weekday".into());
    }
    if days.len() == 7 {
        return Ok("*".into());
    }
    Ok(days
        .into_iter()
        .map(|day| (day + 1).to_string())
        .collect::<Vec<_>>()
        .join(","))
}

fn expand_dow_part(part: &str, days: &mut BTreeSet<u8>) -> Result<(), String> {
    if part.is_empty() {
        return Err("Invalid cron: empty weekday".into());
    }
    let (base, step) = match part.split_once('/') {
        Some((base, step)) => {
            let step: u8 = step
                .parse()
                .map_err(|_| "Invalid cron: bad weekday step".to_string())?;
            if step == 0 {
                return Err("Invalid cron: weekday step cannot be 0".into());
            }
            (base, step)
        }
        None => (part, 1u8),
    };
    if base == "*" {
        let mut day = 0u8;
        while day <= 6 {
            days.insert(day);
            match day.checked_add(step) {
                Some(next) => day = next,
                None => break,
            }
        }
        return Ok(());
    }
    let (start, end) = if let Some((lo, hi)) = base.split_once('-') {
        (parse_dow_bound(lo)?, parse_dow_bound(hi)?)
    } else {
        let n = parse_dow_bound(base)?;
        let end = if step == 1 { n } else { 7 };
        (n, end)
    };
    if start > end {
        return Err("Invalid cron: weekday range".into());
    }
    let mut n = start;
    loop {
        let day = if n == 7 { 0 } else { n };
        if day > 6 {
            return Err(format!("Invalid cron: weekday {n}"));
        }
        days.insert(day);
        match n.checked_add(step) {
            Some(next) if next <= end => n = next,
            _ => break,
        }
    }
    Ok(())
}

/// Numeric 0 and 7 are Sunday. Names use Sunday = 0 … Saturday = 6. The value 7
/// is kept so a range like `5-7` still walks Friday through Sunday.
fn parse_dow_bound(token: &str) -> Result<u8, String> {
    let token = token.trim();
    if let Ok(n) = token.parse::<u8>() {
        if n > 7 {
            return Err(format!("Invalid cron: weekday {n}"));
        }
        return Ok(n);
    }
    let day = match token.to_ascii_lowercase().as_str() {
        "sun" | "sunday" => 0,
        "mon" | "monday" => 1,
        "tue" | "tues" | "tuesday" => 2,
        "wed" | "wednesday" => 3,
        "thu" | "thur" | "thurs" | "thursday" => 4,
        "fri" | "friday" => 5,
        "sat" | "saturday" => 6,
        _ => return Err(format!("Invalid cron: weekday {token}")),
    };
    Ok(day)
}

fn next_fire<Tz>(schedule: &Schedule, after: &DateTime<Tz>) -> Result<DateTime<Tz>, String>
where
    Tz: TimeZone + Clone,
    Tz::Offset: std::fmt::Display,
{
    schedule
        .after(after)
        .next()
        .ok_or_else(|| "Cron never fires".to_string())
}

fn cron_parts(expr: &str) -> Result<Vec<Schedule>, String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Err("Cron must have 5 fields: minute hour day month weekday".into());
    }
    let mut schedules = Vec::new();
    for part in trimmed.split(';') {
        let part = part.trim();
        if part.is_empty() {
            return Err("Invalid cron: empty schedule".into());
        }
        schedules.push(parse_cron(part)?);
    }
    Ok(schedules)
}

fn earliest_fire<Tz>(cron: &str, after: &DateTime<Tz>) -> Result<DateTime<Tz>, String>
where
    Tz: TimeZone + Clone,
    Tz::Offset: std::fmt::Display,
{
    let mut best: Option<DateTime<Tz>> = None;
    for schedule in cron_parts(cron)? {
        let next = next_fire(&schedule, after)?;
        best = Some(match best {
            Some(current) if current <= next => current,
            _ => next,
        });
    }
    best.ok_or_else(|| "Cron never fires".to_string())
}

fn next_from_cron(cron: &str, after: &DateTime<Local>) -> Result<String, String> {
    Ok(earliest_fire(cron, after)?.to_rfc3339())
}

fn parse_local(raw: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.with_timezone(&Local))
}

fn read_routine_file(path: &Path) -> Result<Routine, String> {
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw).map_err(|err| format!("Invalid routine file: {err}"))
}

fn read_routine(root: &Path, id: &str) -> Result<Routine, String> {
    validate_id(id)?;
    let path = routine_path(root, id);
    if !path.is_file() {
        return Err("Routine not found".into());
    }
    let mut doc = read_routine_file(&path)?;
    doc.id = id.to_string();
    if settle_job_folder(root, &mut doc)? {
        write_routine(root, &doc)?;
    }
    doc.runs.clear();
    Ok(doc)
}

fn write_routine(root: &Path, doc: &Routine) -> Result<(), String> {
    validate_id(&doc.id)?;
    let dir = routines_dir(root);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let mut value = serde_json::to_value(doc).map_err(|err| err.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        obj.remove("enabled");
        obj.remove("runs");
    }
    let body = serde_json::to_string_pretty(&value).map_err(|err| err.to_string())?;
    fs::write(routine_path(root, &doc.id), format!("{body}\n")).map_err(|err| err.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct EnabledDoc {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    by_vault: BTreeMap<String, BTreeSet<String>>,
}

fn vault_key(root: &Path) -> String {
    root.to_string_lossy().to_string()
}

fn enabled_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Cannot resolve app data dir: {err}"))?;
    Ok(dir.join("routine-enabled.json"))
}

fn read_enabled_doc(app: &AppHandle) -> EnabledDoc {
    let Ok(path) = enabled_file(app) else {
        return EnabledDoc::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return EnabledDoc::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_enabled_doc(app: &AppHandle, doc: &EnabledDoc) -> Result<(), String> {
    let path = enabled_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let body = serde_json::to_string_pretty(doc).map_err(|err| err.to_string())?;
    fs::write(path, format!("{body}\n")).map_err(|err| err.to_string())
}

fn load_enabled_ids(app: &AppHandle, vault: &Path) -> BTreeSet<String> {
    read_enabled_doc(app)
        .by_vault
        .get(&vault_key(vault))
        .cloned()
        .unwrap_or_default()
}

fn set_enabled_flag(app: &AppHandle, vault: &Path, id: &str, enabled: bool) -> Result<(), String> {
    validate_id(id)?;
    let key = vault_key(vault);
    let mut doc = read_enabled_doc(app);
    doc.version = 1;
    let entry = doc.by_vault.entry(key.clone()).or_default();
    if enabled {
        entry.insert(id.to_string());
    } else {
        entry.remove(id);
    }
    if doc.by_vault.get(&key).is_some_and(|ids| ids.is_empty()) {
        doc.by_vault.remove(&key);
    }
    write_enabled_doc(app, &doc)
}

fn apply_enabled(routines: &mut [Routine], enabled: &BTreeSet<String>) {
    for routine in routines {
        routine.enabled = enabled.contains(&routine.id);
    }
}

fn read_all(root: &Path) -> Result<Vec<Routine>, String> {
    let dir = routines_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        if validate_id(id).is_err() {
            continue;
        }
        if let Ok(mut doc) = read_routine_file(&path) {
            doc.id = id.to_string();
            if settle_job_folder(root, &mut doc).unwrap_or(false) {
                let _ = write_routine(root, &doc);
            }
            doc.runs.clear();
            out.push(doc);
        }
    }
    out.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(out)
}

fn claim_due(
    root: &Path,
    now: DateTime<Local>,
    trigger: RunTrigger,
    enabled: &BTreeSet<String>,
) -> Result<Vec<PendingRun>, String> {
    let docs = read_all(root)?;
    let mut claimed = Vec::new();
    for mut doc in docs {
        if !enabled.contains(&doc.id) {
            continue;
        }
        let due = match doc.next_run_at.as_deref().and_then(parse_local) {
            Some(at) => at <= now,
            None => {
                if let Ok(next) = next_from_cron(&doc.cron, &now) {
                    doc.next_run_at = Some(next);
                    write_routine(root, &doc)?;
                }
                false
            }
        };
        if !due {
            continue;
        }
        let Ok(next) = next_from_cron(&doc.cron, &now) else {
            continue;
        };
        doc.next_run_at = Some(next);
        write_routine(root, &doc)?;
        claimed.push(PendingRun {
            id: doc.id,
            trigger,
        });
    }
    Ok(claimed)
}

#[cfg(test)]
fn append_run(
    root: &Path,
    id: &str,
    trigger: RunTrigger,
    at: DateTime<Local>,
) -> Result<(), String> {
    append_run_report(root, id, trigger, at, "ok", "")
}

fn append_run_report(
    root: &Path,
    id: &str,
    trigger: RunTrigger,
    at: DateTime<Local>,
    status: &str,
    report: &str,
) -> Result<(), String> {
    let doc = read_routine(root, id)?;
    let dir = root.join(&doc.folder);
    write_run_file(&dir, at, trigger, status, report, &[])?;
    prune_job_dir(&dir)?;
    Ok(())
}

fn append_command_report(
    root: &Path,
    id: &str,
    trigger: RunTrigger,
    at: DateTime<Local>,
    report: &CommandReport,
) -> Result<(), String> {
    let doc = read_routine(root, id)?;
    let dir = root.join(&doc.folder);
    let extra = vec![
        header_line("Command", &report.command),
        header_line("Cwd", &report.cwd_label),
        header_line("Exit", &report.exit_label),
    ];
    write_run_file(&dir, at, trigger, &report.status, &report.body, &extra)?;
    prune_job_dir(&dir)?;
    Ok(())
}

fn header_line(label: &str, value: &str) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("- {label}: {collapsed}")
}

fn trigger_name(trigger: RunTrigger) -> &'static str {
    match trigger {
        RunTrigger::Schedule => "schedule",
        RunTrigger::Manual => "manual",
        RunTrigger::Catchup => "catchup",
    }
}

fn sanitize_folder_name(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push(' ');
        } else {
            out.push(ch);
        }
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches('.').trim();
    let trimmed: String = trimmed.chars().take(MAX_NAME_CHARS).collect();
    if trimmed.is_empty() {
        "Routine".into()
    } else {
        trimmed
    }
}

fn routines_child(rel: &str) -> bool {
    let Some(rest) = rel.strip_prefix("Routines/") else {
        return false;
    };
    !rest.is_empty() && !rest.contains('/') && rest != "." && rest != ".."
}

fn folder_leaf(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

fn unique_folder(root: &Path, leaf: &str, keep: Option<&str>) -> String {
    for n in 0..1000 {
        let name = if n == 0 {
            leaf.to_string()
        } else {
            format!("{leaf} {}", n + 1)
        };
        let rel = format!("{ROUTINES_ROOT}/{name}");
        if keep == Some(rel.as_str()) || !root.join(&rel).exists() {
            return rel;
        }
    }
    format!("{ROUTINES_ROOT}/{leaf}")
}

fn place_folder(root: &Path, name: &str, current: Option<&str>) -> Result<String, String> {
    let leaf = sanitize_folder_name(name);
    if let Some(current) = current.filter(|folder| routines_child(folder)) {
        if folder_leaf(current) == leaf {
            fs::create_dir_all(root.join(current)).map_err(|err| err.to_string())?;
            return Ok(current.to_string());
        }
        let next = unique_folder(root, &leaf, Some(current));
        rename_job_folder(root, current, &next)?;
        return Ok(next);
    }
    let rel = unique_folder(root, &leaf, None);
    fs::create_dir_all(root.join(&rel)).map_err(|err| err.to_string())?;
    Ok(rel)
}

fn rename_job_folder(root: &Path, from: &str, to: &str) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    if !routines_child(from) || !routines_child(to) {
        return Err("Routine folder must stay inside Routines/".into());
    }
    let from_full = root.join(from);
    let to_full = root.join(to);
    if to_full.exists() {
        return Err("Target already exists".into());
    }
    if let Some(parent) = to_full.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    if from_full.exists() {
        fs::rename(&from_full, &to_full).map_err(|err| err.to_string())?;
    } else {
        fs::create_dir_all(&to_full).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn remove_job_folder(root: &Path, folder: &str) -> Result<(), String> {
    if !routines_child(folder) {
        return Ok(());
    }
    let full = root.join(folder);
    if full.is_dir() {
        fs::remove_dir_all(full).map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Creates the job folder and turns a legacy `runs` array into markdown files.
fn settle_job_folder(root: &Path, doc: &mut Routine) -> Result<bool, String> {
    let mut changed = false;
    if !routines_child(&doc.folder) {
        doc.folder = place_folder(root, &doc.name, None)?;
        changed = true;
    } else if !root.join(&doc.folder).is_dir() {
        fs::create_dir_all(root.join(&doc.folder)).map_err(|err| err.to_string())?;
        changed = true;
    }
    if doc.runs.is_empty() {
        return Ok(changed);
    }
    let dir = root.join(&doc.folder);
    for run in doc.runs.drain(..) {
        let at = parse_local(&run.at).unwrap_or_else(Local::now);
        write_run_file(&dir, at, run.trigger, &run.status, "", &[])?;
    }
    Ok(true)
}

fn is_run_stamp(stamp: &str) -> bool {
    let bytes = stamp.as_bytes();
    bytes.len() == 19
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b' '
        && bytes[13] == b'-'
        && bytes[16] == b'-'
        && stamp
            .chars()
            .enumerate()
            .all(|(index, ch)| matches!(index, 4 | 7 | 10 | 13 | 16) || ch.is_ascii_digit())
}

fn parse_run_stem(stem: &str) -> Option<(String, String)> {
    let (left, trigger) = stem.rsplit_once(' ')?;
    if !matches!(trigger, "schedule" | "manual" | "catchup") {
        return None;
    }
    if left.len() < 19 || !is_run_stamp(&left[..19]) {
        return None;
    }
    if left.len() > 19 {
        let rest = &left[19..];
        if !rest.starts_with('-')
            || rest.len() < 2
            || !rest[1..].chars().all(|ch| ch.is_ascii_digit())
        {
            return None;
        }
    }
    Some((left[..19].to_string(), trigger.to_string()))
}

fn display_stamp(stamp: &str) -> String {
    match stamp.split_once(' ') {
        Some((date, time)) => format!("{date} {}", time.replace('-', ":")),
        None => stamp.to_string(),
    }
}

fn write_run_file(
    dir: &Path,
    at: DateTime<Local>,
    trigger: RunTrigger,
    status: &str,
    report: &str,
    extra_header: &[String],
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let stamp = at.format("%Y-%m-%d %H-%M-%S").to_string();
    let trigger_name = trigger_name(trigger);
    let mut name = format!("{stamp} {trigger_name}.md");
    let mut suffix = 2u32;
    while dir.join(&name).exists() {
        name = format!("{stamp}-{suffix} {trigger_name}.md");
        suffix += 1;
        if suffix > 100 {
            return Err("Too many runs in the same second".into());
        }
    }
    let display = display_stamp(&stamp);
    let report: String = report.trim().chars().take(MAX_REPORT_CHARS).collect();
    let mut header = format!("- Trigger: {trigger_name}\n- Status: {status}\n");
    for line in extra_header {
        header.push_str(line);
        header.push('\n');
    }
    let body = if report.is_empty() {
        format!("# {display}\n\n{header}")
    } else {
        format!("# {display}\n\n{header}\n{report}\n")
    };
    fs::write(dir.join(name), body).map_err(|err| err.to_string())
}

fn read_run_status(path: &Path) -> String {
    let Ok(text) = fs::read_to_string(path) else {
        return "done".into();
    };
    for line in text.lines().take(12) {
        if let Some(rest) = line.strip_prefix("- Status:") {
            let status = rest.trim();
            if !status.is_empty() {
                return status.to_string();
            }
        }
    }
    "done".into()
}

fn delete_run_file(root: &Path, folder: &str, path: &str) -> Result<(), String> {
    if !routines_child(folder) {
        return Err("Routine folder must stay inside Routines/".into());
    }
    let rel = path.trim().trim_start_matches('/');
    let prefix = format!("{folder}/");
    let Some(file_name) = rel
        .strip_prefix(&prefix)
        .filter(|name| !name.is_empty() && !name.contains('/') && !name.contains('\\'))
    else {
        return Err("Run is not in this routine".into());
    };
    let Some(stem) = file_name.strip_suffix(".md") else {
        return Err("Not a run log".into());
    };
    if parse_run_stem(stem).is_none() {
        return Err("Not a run log".into());
    }
    let full = root.join(rel);
    if full.is_file() {
        fs::remove_file(&full).map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Drops old run logs and anything else in the job folder.
/// Keeps the newest [`MAX_KEPT_RUNS`] logs plus `.brief-attachments` and `.folder.md`.
/// Names decide what stays, so report bodies are not opened.
fn prune_job_dir(dir: &Path) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }
    let mut runs: Vec<(String, PathBuf)> = Vec::new();
    let mut garbage: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            garbage.push(path);
            continue;
        };
        if name == BRIEF_ATTACHMENTS_DIR {
            if path.is_dir() {
                continue;
            }
            garbage.push(path);
            continue;
        }
        if name == ".folder.md" && path.is_file() {
            continue;
        }
        if let Some(stem) = name.strip_suffix(".md") {
            if path.is_file() && parse_run_stem(stem).is_some() {
                runs.push((name, path));
                continue;
            }
        }
        garbage.push(path);
    }
    runs.sort_by(|a, b| b.0.cmp(&a.0));
    if runs.len() > MAX_KEPT_RUNS {
        garbage.extend(runs.into_iter().skip(MAX_KEPT_RUNS).map(|(_, path)| path));
    }
    for path in garbage {
        remove_job_garbage(&path);
    }
    Ok(())
}

fn remove_job_garbage(path: &Path) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    let result = if meta.file_type().is_symlink() || !meta.is_dir() {
        fs::remove_file(path)
    } else {
        fs::remove_dir_all(path)
    };
    if let Err(err) = result {
        eprintln!("routine prune {}: {err}", path.display());
    }
}

fn list_run_files(root: &Path, folder: &str) -> Result<Vec<RoutineRunFile>, String> {
    if !routines_child(folder) {
        return Ok(Vec::new());
    }
    let dir = root.join(folder);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    prune_job_dir(&dir)?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(stem) = file_name.strip_suffix(".md") else {
            continue;
        };
        let Some((stamp, trigger)) = parse_run_stem(stem) else {
            continue;
        };
        files.push((file_name.to_string(), path, stamp, trigger));
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.truncate(MAX_KEPT_RUNS);
    Ok(files
        .into_iter()
        .map(|(file_name, path, stamp, trigger)| RoutineRunFile {
            path: format!("{folder}/{file_name}"),
            at: display_stamp(&stamp),
            trigger,
            status: read_run_status(&path),
        })
        .collect())
}

fn upsert(root: &Path, input: UpsertRoutineArgs, now: DateTime<Local>) -> Result<Routine, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Name is required".into());
    }
    let name: String = name.chars().take(MAX_NAME_CHARS).collect();
    let cron = input.cron.trim().to_string();
    cron_parts(&cron)?;

    let id = match input.id {
        Some(id) => {
            validate_id(&id)?;
            id
        }
        None => new_id(),
    };
    let existing = read_routine(root, &id).ok();
    let folder = place_folder(
        root,
        &name,
        existing.as_ref().map(|doc| doc.folder.as_str()),
    )?;
    let cron_changed = existing
        .as_ref()
        .map(|doc| doc.cron != cron)
        .unwrap_or(true);
    let next_run_at = if cron_changed {
        Some(next_from_cron(&cron, &now)?)
    } else {
        existing
            .as_ref()
            .and_then(|doc| doc.next_run_at.clone())
            .or(Some(next_from_cron(&cron, &now)?))
    };
    let prev = existing.as_ref();
    let mode = normalize_mode(&keep_string(input.mode, prev.map(|doc| doc.mode.as_str())));
    let reasoning_mode = normalize_reasoning(&keep_string(
        input.reasoning_mode,
        prev.map(|doc| doc.reasoning_mode.as_str()),
    ));
    let previous_folder = prev.map(|doc| doc.folder.clone());
    let mut attachments = input
        .attachments
        .unwrap_or_else(|| prev.map(|doc| doc.attachments.clone()).unwrap_or_default());
    if let Some(previous) = previous_folder.as_deref() {
        if previous != folder {
            remap_attachment_paths(&mut attachments, previous, &folder);
        }
    }
    validate_attachments(&folder, &attachments)?;
    let kind = normalize_kind(&keep_string(input.kind, prev.map(|doc| doc.kind.as_str())));
    let command = keep_string(input.command, prev.map(|doc| doc.command.as_str()));
    validate_stored_command(&command)?;
    let command_cwd = keep_string(input.command_cwd, prev.map(|doc| doc.command_cwd.as_str()));
    if command_cwd.contains('\0') {
        return Err("Invalid cwd".into());
    }
    let command_timeout_ms = normalize_timeout_ms(match input.command_timeout_ms {
        Some(ms) => ms,
        None => prev.map(|doc| doc.command_timeout_ms).unwrap_or(0),
    });
    let doc = Routine {
        id,
        name,
        enabled: false,
        cron,
        folder,
        next_run_at,
        runs: Vec::new(),
        brief: keep_string(input.brief, prev.map(|doc| doc.brief.as_str())),
        project_path: keep_string(input.project_path, prev.map(|doc| doc.project_path.as_str())),
        mode,
        model_id: keep_string(input.model_id, prev.map(|doc| doc.model_id.as_str())),
        reasoning_mode,
        specialist_model_id: keep_string(
            input.specialist_model_id,
            prev.map(|doc| doc.specialist_model_id.as_str()),
        ),
        specialists_use_chat_model: input
            .specialists_use_chat_model
            .unwrap_or_else(|| prev.is_some_and(|doc| doc.specialists_use_chat_model)),
        attachments,
        kind,
        command,
        command_cwd,
        command_timeout_ms,
    };
    write_routine(root, &doc)?;
    Ok(doc)
}

fn keep_string(next: Option<String>, prev: Option<&str>) -> String {
    match next {
        Some(value) => value,
        None => prev.unwrap_or("").to_string(),
    }
}

fn normalize_mode(mode: &str) -> String {
    match mode.trim() {
        "ask" => "ask".into(),
        "agent" => "agent".into(),
        _ => String::new(),
    }
}

fn normalize_kind(kind: &str) -> String {
    if is_command_kind(kind) {
        "command".into()
    } else {
        String::new()
    }
}

fn normalize_timeout_ms(ms: u64) -> u64 {
    if ms == 0 {
        0
    } else {
        terminal::clamp_timeout_ms(Some(ms))
    }
}

fn validate_stored_command(command: &str) -> Result<(), String> {
    if command.contains('\0') {
        return Err("Invalid command".into());
    }
    if command.chars().count() > terminal::MAX_COMMAND_CHARS {
        return Err("Command is too long".into());
    }
    Ok(())
}

fn normalize_reasoning(mode: &str) -> String {
    match mode.trim() {
        "off" | "auto" | "on" => mode.trim().to_string(),
        _ => String::new(),
    }
}

fn remap_attachment_paths(attachments: &mut [RoutineAttachmentRef], from: &str, to: &str) {
    let old = format!("{from}/.brief-attachments/");
    let new_prefix = format!("{to}/.brief-attachments/");
    for attachment in attachments.iter_mut() {
        if let Some(name) = attachment.path.strip_prefix(&old) {
            attachment.path = format!("{new_prefix}{name}");
        }
    }
}

fn validate_attachments(folder: &str, attachments: &[RoutineAttachmentRef]) -> Result<(), String> {
    let prefix = format!("{folder}/.brief-attachments/");
    for attachment in attachments {
        let path = attachment.path.trim().trim_start_matches('/');
        let Some(name) = path.strip_prefix(&prefix) else {
            return Err("Attachment must stay inside the routine folder".into());
        };
        if name.is_empty()
            || name.contains('/')
            || name.contains('\\')
            || name.contains("..")
            || attachment.id.trim().is_empty()
        {
            return Err("Attachment must stay inside the routine folder".into());
        }
    }
    Ok(())
}

fn normalize_run_status(status: &str) -> String {
    match status.trim() {
        "done" | "needs you" | "failed" => status.trim().to_string(),
        _ => "failed".into(),
    }
}

fn snapshot(app: &AppHandle, root: &Path) -> Result<RoutineSnapshot, String> {
    let rt = runtime();
    let epoch = rt.epoch();
    let mut routines = read_all(root)?;
    apply_enabled(&mut routines, &load_enabled_ids(app, root));
    Ok(RoutineSnapshot {
        routines,
        running_id: rt.running_id(epoch),
        epoch,
    })
}

#[tauri::command]
pub fn list_routines(app: AppHandle, state: State<VaultState>) -> Result<RoutineSnapshot, String> {
    let root = get_root(&state)?;
    let _io = runtime().io.lock();
    snapshot(&app, &root)
}

#[tauri::command]
pub fn upsert_routine(
    app: AppHandle,
    state: State<VaultState>,
    args: UpsertRoutineArgs,
) -> Result<Routine, String> {
    let root = get_root(&state)?;
    let _io = runtime().io.lock();
    let mut doc = upsert(&root, args, Local::now())?;
    doc.enabled = load_enabled_ids(&app, &root).contains(&doc.id);
    Ok(doc)
}

#[tauri::command]
pub fn set_routine_enabled(
    app: AppHandle,
    state: State<VaultState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let root = get_root(&state)?;
    validate_id(&id)?;
    let _io = runtime().io.lock();
    let _doc = read_routine(&root, &id)?;
    set_enabled_flag(&app, &root, &id, enabled)
}

#[tauri::command]
pub fn delete_routine(app: AppHandle, state: State<VaultState>, id: String) -> Result<(), String> {
    let root = get_root(&state)?;
    validate_id(&id)?;
    let _io = runtime().io.lock();
    let doc = read_routine(&root, &id).ok();
    let path = routine_path(&root, &id);
    if path.exists() {
        fs::remove_file(&path).map_err(|err| err.to_string())?;
    }
    if let Some(doc) = doc {
        remove_job_folder(&root, &doc.folder)?;
    }
    set_enabled_flag(&app, &root, &id, false)?;
    Ok(())
}

#[tauri::command]
pub fn list_routine_runs(
    state: State<VaultState>,
    id: String,
) -> Result<Vec<RoutineRunFile>, String> {
    let root = get_root(&state)?;
    validate_id(&id)?;
    let _io = runtime().io.lock();
    let doc = read_routine(&root, &id)?;
    list_run_files(&root, &doc.folder)
}

#[tauri::command]
pub fn delete_routine_run(
    state: State<VaultState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let root = get_root(&state)?;
    validate_id(&id)?;
    let _io = runtime().io.lock();
    let doc = read_routine(&root, &id)?;
    delete_run_file(&root, &doc.folder, &path)
}

#[tauri::command]
pub fn run_routine_now(state: State<VaultState>, id: String) -> Result<(), String> {
    let root = get_root(&state)?;
    validate_id(&id)?;
    {
        let _io = runtime().io.lock();
        let _doc = read_routine(&root, &id)?;
    }
    let tx = runtime()
        .tx
        .lock()
        .clone()
        .ok_or_else(|| "Scheduler is not running".to_string())?;
    tx.send(WorkerMsg::RunNow(id))
        .map_err(|_| "Scheduler stopped".to_string())
}

#[tauri::command]
pub fn complete_routine_run(args: CompleteRoutineRunArgs) -> Result<(), String> {
    validate_id(&args.id)?;
    let outcome = RunOutcome {
        status: normalize_run_status(&args.status),
        body: args.body.chars().take(MAX_REPORT_CHARS).collect(),
    };
    let tx = runtime()
        .completions
        .lock()
        .remove(&(args.epoch, args.id))
        .ok_or_else(|| "This run is not waiting".to_string())?;
    tx.send(outcome)
        .map_err(|_| "Run finished already".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, Timelike};

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markspace-routines-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn pending(id: &str) -> PendingRun {
        PendingRun {
            id: id.to_string(),
            trigger: RunTrigger::Schedule,
        }
    }

    fn args(id: Option<&str>, name: &str, cron: &str) -> UpsertRoutineArgs {
        UpsertRoutineArgs {
            id: id.map(str::to_string),
            name: name.into(),
            cron: cron.into(),
            brief: None,
            project_path: None,
            mode: None,
            model_id: None,
            reasoning_mode: None,
            specialist_model_id: None,
            specialists_use_chat_model: None,
            attachments: None,
            kind: None,
            command: None,
            command_cwd: None,
            command_timeout_ms: None,
        }
    }

    #[test]
    fn next_daily_nine_is_tomorrow_after_ten() {
        let schedule = parse_cron("0 9 * * *").unwrap();
        let tz = FixedOffset::east_opt(4 * 3600).unwrap();
        let after = tz.with_ymd_and_hms(2026, 10, 1, 10, 0, 0).unwrap();
        let next = next_fire(&schedule, &after).unwrap();
        assert_eq!(next.date_naive().to_string(), "2026-10-02");
        assert_eq!(next.hour(), 9);
        assert_eq!(next.minute(), 0);
    }

    #[test]
    fn hourly_window_stays_on_weekdays() {
        let schedule = parse_cron("0 9-18 * * 1-5").unwrap();
        let tz = FixedOffset::east_opt(4 * 3600).unwrap();
        let midday = tz.with_ymd_and_hms(2026, 10, 5, 12, 30, 0).unwrap();
        let next = next_fire(&schedule, &midday).unwrap();
        assert_eq!(next.date_naive().to_string(), "2026-10-05");
        assert_eq!(next.hour(), 13);

        let after_close = tz.with_ymd_and_hms(2026, 10, 5, 18, 0, 0).unwrap();
        let tomorrow = next_fire(&schedule, &after_close).unwrap();
        assert_eq!(tomorrow.date_naive().to_string(), "2026-10-06");
        assert_eq!(tomorrow.hour(), 9);

        let saturday = tz.with_ymd_and_hms(2026, 10, 3, 10, 0, 0).unwrap();
        let monday = next_fire(&schedule, &saturday).unwrap();
        assert_eq!(monday.date_naive().to_string(), "2026-10-05");
        assert_eq!(monday.hour(), 9);
    }

    #[test]
    fn quarter_hour_window_steps_fifteen_minutes() {
        let tz = FixedOffset::east_opt(4 * 3600).unwrap();
        let cron = "15,30,45 9 * * 1-5;*/15 10-17 * * 1-5;0 18 * * 1-5";
        // Monday 2026-10-05 09:00 → 09:15, then 18:00 is the last slot, then Tuesday.
        let at_nine = tz.with_ymd_and_hms(2026, 10, 5, 9, 0, 0).unwrap();
        let first = earliest_fire(cron, &at_nine).unwrap();
        assert_eq!(first.hour(), 9);
        assert_eq!(first.minute(), 15);

        let before_close = tz.with_ymd_and_hms(2026, 10, 5, 17, 45, 0).unwrap();
        let last = earliest_fire(cron, &before_close).unwrap();
        assert_eq!(last.date_naive().to_string(), "2026-10-05");
        assert_eq!(last.hour(), 18);
        assert_eq!(last.minute(), 0);

        let after_close = tz.with_ymd_and_hms(2026, 10, 5, 18, 0, 0).unwrap();
        let tuesday = earliest_fire(cron, &after_close).unwrap();
        assert_eq!(tuesday.date_naive().to_string(), "2026-10-06");
        assert_eq!(tuesday.hour(), 9);
        assert_eq!(tuesday.minute(), 15);

        let saturday = tz.with_ymd_and_hms(2026, 10, 3, 10, 0, 0).unwrap();
        let monday = earliest_fire(cron, &saturday).unwrap();
        assert_eq!(monday.date_naive().to_string(), "2026-10-05");
        assert_eq!(monday.hour(), 9);
        assert_eq!(monday.minute(), 15);
    }

    #[test]
    fn weekdays_skip_the_weekend() {
        let schedule = parse_cron("0 9 * * 1-5").unwrap();
        let tz = FixedOffset::east_opt(4 * 3600).unwrap();
        // Saturday 2026-10-03 10:00 → Monday 2026-10-05 09:00.
        let after = tz.with_ymd_and_hms(2026, 10, 3, 10, 0, 0).unwrap();
        let next = next_fire(&schedule, &after).unwrap();
        assert_eq!(next.date_naive().to_string(), "2026-10-05");
        assert_eq!(next.hour(), 9);
    }

    #[test]
    fn invalid_cron_is_rejected_and_not_stored() {
        let root = temp_root();
        let err = upsert(
            &root,
            args(None, "Broken", "nope"),
            Local::now(),
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("cron") || err.contains("field"));
        assert!(read_all(&root).unwrap().is_empty());

        let err = upsert(
            &root,
            args(None, "Short", "0 9 * *"),
            Local::now(),
        )
        .unwrap_err();
        assert!(err.contains("5 fields"));
        assert!(read_all(&root).unwrap().is_empty());
    }

    #[test]
    fn catch_up_claims_once_and_skips_the_backlog() {
        let root = temp_root();
        let now = Local::now();
        let past = now - chrono::Duration::hours(30);
        let saved = upsert(
            &root,
            args(Some("daily"), "Daily", "0 9 * * *"),
            now,
        )
        .unwrap();
        let mut overdue = saved;
        overdue.next_run_at = Some(past.to_rfc3339());
        write_routine(&root, &overdue).unwrap();

        let enabled = BTreeSet::from(["daily".to_string()]);
        let first = claim_due(&root, now, RunTrigger::Catchup, &enabled).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].id, "daily");
        assert_eq!(first[0].trigger, RunTrigger::Catchup);

        let second = claim_due(&root, now, RunTrigger::Catchup, &enabled).unwrap();
        assert!(second.is_empty());

        let loaded = read_routine(&root, "daily").unwrap();
        let next = parse_local(loaded.next_run_at.as_deref().unwrap()).unwrap();
        assert!(next.timestamp() > now.timestamp());
        assert!(loaded.runs.is_empty());
    }

    #[test]
    fn disabled_routine_is_not_claimed() {
        let root = temp_root();
        let now = Local::now();
        let mut doc = upsert(
            &root,
            args(Some("off"), "Off", "0 * * * *"),
            now,
        )
        .unwrap();
        doc.next_run_at = Some((now - chrono::Duration::hours(2)).to_rfc3339());
        write_routine(&root, &doc).unwrap();
        let raw = fs::read_to_string(routine_path(&root, "off")).unwrap();
        assert!(!raw.contains("enabled"));
        assert!(
            claim_due(&root, now, RunTrigger::Schedule, &BTreeSet::new())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn second_routine_does_not_start_while_the_first_is_running() {
        let mut gate = RunGate::default();
        assert!(gate.try_begin(pending("a")));
        assert!(!gate.try_begin(pending("b")));
        assert_eq!(gate.running.as_ref().map(|run| run.id.as_str()), Some("a"));
        assert_eq!(gate.queued.len(), 1);
        assert!(!gate.try_begin(pending("c")));
        assert_eq!(gate.queued.len(), 2);

        let next = gate.finish().unwrap();
        assert_eq!(next.id, "b");
        assert_eq!(gate.running.as_ref().map(|run| run.id.as_str()), Some("b"));
        assert!(gate.finish().is_some());
        assert!(gate.finish().is_none());
        assert!(gate.running.is_none());
    }

    #[test]
    fn run_is_a_markdown_file_and_not_json() {
        let root = temp_root();
        let saved = upsert(
            &root,
            args(Some("job"), "Morning", "0 9 * * *"),
            Local::now(),
        )
        .unwrap();
        assert_eq!(saved.folder, "Routines/Morning");
        assert!(root.join(&saved.folder).is_dir());
        let at = Local.with_ymd_and_hms(2026, 10, 1, 16, 32, 0).unwrap();
        append_run(&root, "job", RunTrigger::Schedule, at).unwrap();
        let raw = fs::read_to_string(routine_path(&root, "job")).unwrap();
        assert!(!raw.contains("runs"));
        let files = list_run_files(&root, &saved.folder).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].trigger, "schedule");
        assert_eq!(files[0].at, "2026-10-01 16:32:00");
        assert!(files[0].path.ends_with("2026-10-01 16-32-00 schedule.md"));
        let body = fs::read_to_string(root.join(&files[0].path)).unwrap();
        assert!(body.contains("Status: ok"));
        delete_run_file(&root, &saved.folder, &files[0].path).unwrap();
        assert!(list_run_files(&root, &saved.folder).unwrap().is_empty());
        assert!(!root.join(&files[0].path).exists());
        fs::write(root.join(&saved.folder).join("notes.md"), "keep").unwrap();
        assert!(delete_run_file(&root, &saved.folder, "Routines/Morning/notes.md").is_err());
        assert!(root.join(&saved.folder).join("notes.md").is_file());
        assert!(delete_run_file(
            &root,
            &saved.folder,
            "Routines/Other/2026-10-01 16-32-00 schedule.md"
        )
        .is_err());
    }

    #[test]
    fn legacy_runs_become_markdown_files() {
        let root = temp_root();
        let at = Local.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap();
        fs::create_dir_all(routines_dir(&root)).unwrap();
        let raw = format!(
            r#"{{"id":"old","name":"Old","cron":"0 9 * * *","runs":[{{"at":"{}","trigger":"manual","status":"ok"}}]}}"#,
            at.to_rfc3339()
        );
        fs::write(routine_path(&root, "old"), raw).unwrap();
        let loaded = read_routine(&root, "old").unwrap();
        assert!(loaded.runs.is_empty());
        assert_eq!(loaded.folder, "Routines/Old");
        let files = list_run_files(&root, &loaded.folder).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].trigger, "manual");
        let stored = fs::read_to_string(routine_path(&root, "old")).unwrap();
        assert!(!stored.contains("runs"));
    }

    #[test]
    fn parse_run_filename_keeps_the_stamp_and_trigger() {
        assert_eq!(
            parse_run_stem("2026-10-01 16-32-00 schedule"),
            Some(("2026-10-01 16-32-00".into(), "schedule".into()))
        );
        assert_eq!(
            parse_run_stem("2026-10-01 16-32-00-2 manual"),
            Some(("2026-10-01 16-32-00".into(), "manual".into()))
        );
        assert!(parse_run_stem("notes").is_none());
    }

    #[test]
    fn name_upsert_keeps_the_brief() {
        let root = temp_root();
        let mut first = args(Some("job"), "Morning", "0 9 * * *");
        first.brief = Some("File the inbox".into());
        first.mode = Some("agent".into());
        first.attachments = Some(vec![RoutineAttachmentRef {
            id: "a1".into(),
            name: "note.txt".into(),
            media_type: "text/plain".into(),
            kind: "text".into(),
            path: "Routines/Morning/.brief-attachments/a1-note.txt".into(),
        }]);
        upsert(&root, first, Local::now()).unwrap();
        let renamed = upsert(&root, args(Some("job"), "Evening", "0 9 * * *"), Local::now()).unwrap();
        assert_eq!(renamed.brief, "File the inbox");
        assert_eq!(renamed.mode, "agent");
        assert_eq!(renamed.attachments.len(), 1);
        assert!(renamed.folder.starts_with("Routines/"));
    }

    #[test]
    fn keeps_twenty_runs_and_drops_garbage() {
        let root = temp_root();
        upsert(
            &root,
            args(Some("job"), "Morning", "0 9 * * *"),
            Local::now(),
        )
        .unwrap();
        let dir = root.join("Routines/Morning");
        fs::create_dir_all(dir.join(".brief-attachments")).unwrap();
        fs::write(dir.join(".brief-attachments/a1-note.txt"), "hi").unwrap();
        fs::write(dir.join(".folder.md"), "overview").unwrap();
        fs::write(dir.join("notes.md"), "junk").unwrap();
        fs::write(dir.join("scratch.txt"), "junk").unwrap();
        fs::create_dir_all(dir.join("scratch")).unwrap();
        fs::write(dir.join("scratch/x.txt"), "x").unwrap();
        for i in 0..25 {
            let name = format!("2026-10-01 10-00-{i:02} schedule.md");
            fs::write(dir.join(&name), "# t\n\n- Status: ok\n").unwrap();
        }
        let files = list_run_files(&root, "Routines/Morning").unwrap();
        assert_eq!(files.len(), 20);
        assert!(files[0].path.ends_with("2026-10-01 10-00-24 schedule.md"));
        assert!(files[19].path.ends_with("2026-10-01 10-00-05 schedule.md"));
        assert!(!dir.join("2026-10-01 10-00-04 schedule.md").exists());
        assert!(!dir.join("notes.md").exists());
        assert!(!dir.join("scratch.txt").exists());
        assert!(!dir.join("scratch").exists());
        assert_eq!(
            fs::read_to_string(dir.join(".brief-attachments/a1-note.txt")).unwrap(),
            "hi"
        );
        assert_eq!(fs::read_to_string(dir.join(".folder.md")).unwrap(), "overview");
    }

    #[test]
    fn report_status_is_readable_from_the_run_file() {
        let root = temp_root();
        upsert(&root, args(Some("job"), "Morning", "0 9 * * *"), Local::now()).unwrap();
        let at = Local.with_ymd_and_hms(2026, 10, 1, 9, 5, 0).unwrap();
        append_run_report(&root, "job", RunTrigger::Manual, at, "needs you", "Which folder?").unwrap();
        let files = list_run_files(&root, "Routines/Morning").unwrap();
        assert_eq!(files[0].status, "needs you");
        let body = fs::read_to_string(root.join(&files[0].path)).unwrap();
        assert!(body.contains("Which folder?"));
    }

    #[test]
    fn legacy_json_without_kind_is_an_agent() {
        let root = temp_root();
        fs::create_dir_all(routines_dir(&root)).unwrap();
        fs::write(
            routine_path(&root, "old"),
            "{\"id\":\"old\",\"name\":\"Old\",\"cron\":\"0 9 * * *\"}\n",
        )
        .unwrap();
        let loaded = read_routine(&root, "old").unwrap();
        assert_eq!(loaded.kind, "");
        assert_eq!(loaded.command, "");
        assert_eq!(loaded.command_cwd, "");
        assert_eq!(loaded.command_timeout_ms, 0);
        assert!(!is_command_kind(&loaded.kind));
    }

    #[test]
    fn upsert_keeps_command_fields() {
        let root = temp_root();
        let mut first = args(Some("job"), "Ping", "0 9 * * *");
        first.kind = Some("command".into());
        first.command = Some("echo hello".into());
        first.command_cwd = Some("Notes".into());
        first.command_timeout_ms = Some(5_000);
        first.brief = Some("keep me".into());
        let saved = upsert(&root, first, Local::now()).unwrap();
        assert_eq!(saved.kind, "command");
        assert_eq!(saved.command, "echo hello");
        assert_eq!(saved.command_cwd, "Notes");
        assert_eq!(saved.command_timeout_ms, 5_000);
        let renamed = upsert(&root, args(Some("job"), "Pong", "0 9 * * *"), Local::now()).unwrap();
        assert_eq!(renamed.kind, "command");
        assert_eq!(renamed.command, "echo hello");
        assert_eq!(renamed.command_cwd, "Notes");
        assert_eq!(renamed.command_timeout_ms, 5_000);
        assert_eq!(renamed.brief, "keep me");
        let back = args(Some("job"), "Pong", "0 9 * * *");
        let mut agent = back;
        agent.kind = Some("agent".into());
        let agent = upsert(&root, agent, Local::now()).unwrap();
        assert_eq!(agent.kind, "");
        assert_eq!(agent.command, "echo hello");
    }

    #[test]
    fn command_card_prefers_the_widget_block() {
        let body = command_card_body(
            "noise\n<!-- widget -->\n**Hi**\n<!-- /widget -->\ntrailing\n",
            "err",
            false,
            "",
        );
        assert_eq!(body, "**Hi**");
        assert_eq!(
            command_card_body("", "nope", true, "Command timed out"),
            "nope"
        );
        assert_eq!(
            command_card_body("", "  ", true, "Command timed out"),
            "Command timed out"
        );
        assert_eq!(command_card_body("", "nope", false, "Command timed out"), "");
    }

    #[test]
    fn empty_command_report_does_not_spawn() {
        let report = failed_without_process("  ", "missing", "Command is empty");
        assert_eq!(report.status, "failed");
        assert_eq!(report.body, "Command is empty");
        assert_eq!(report.exit_label, "-");
        assert_eq!(report.cwd_label, "missing");
    }

    #[test]
    fn command_echo_and_nonzero_exit_write_reports() {
        let root = temp_root();
        let mut input = args(Some("job"), "Ping", "0 9 * * *");
        input.kind = Some("command".into());
        input.command = Some("echo hello-routine".into());
        upsert(&root, input, Local::now()).unwrap();
        let shell = TerminalRuntime::default();
        let (cwd_abs, cwd_rel) = terminal::resolve_terminal_cwd(&root, "").unwrap();
        let ok = terminal::run_shell(
            &shell,
            "routine-job",
            "echo hello-routine",
            &cwd_abs,
            &cwd_rel,
            Duration::from_secs(5),
        )
        .unwrap();
        let report = report_from_shell("echo hello-routine", &cwd_rel, &ok);
        assert_eq!(report.status, "done");
        assert!(report.body.contains("hello-routine"));
        assert_eq!(report.exit_label, "0");
        let at = Local.with_ymd_and_hms(2026, 10, 1, 12, 0, 0).unwrap();
        append_command_report(&root, "job", RunTrigger::Manual, at, &report).unwrap();
        let files = list_run_files(&root, "Routines/Ping").unwrap();
        assert_eq!(files[0].status, "done");
        let body = fs::read_to_string(root.join(&files[0].path)).unwrap();
        assert!(body.contains("- Command: echo hello-routine"));
        assert!(body.contains("- Cwd: vault root"));
        assert!(body.contains("- Exit: 0"));
        assert!(body.contains("hello-routine"));

        let failed = terminal::run_shell(
            &shell,
            "routine-job-fail",
            "exit 3",
            &cwd_abs,
            &cwd_rel,
            Duration::from_secs(5),
        )
        .unwrap();
        let failed_report = report_from_shell("exit 3", &cwd_rel, &failed);
        assert_eq!(failed_report.status, "failed");
        assert_eq!(failed_report.exit_label, "3");
    }
}
