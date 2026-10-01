//! Scheduled routines stored in `{vault}/.markspace/routines/<id>.json`.
//!
//! The tick lives here, not in the webview. It emits `routine-run` only when a
//! run starts or finishes. The empty executor holds `running` briefly so the
//! sidebar spinner can paint; a later agent executor replaces that hold.

use crate::vault::{get_root, VaultState};
use chrono::{DateTime, Local, TimeZone};
use cron::Schedule;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

const MAX_NAME_CHARS: usize = 80;
const ROUTINES_ROOT: &str = "Routines";
const EMPTY_HOLD: Duration = Duration::from_millis(400);
const TICK: Duration = Duration::from_secs(30);

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
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoutineRunFile {
    pub path: String,
    pub at: String,
    pub trigger: String,
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertRoutineArgs {
    pub id: Option<String>,
    pub name: String,
    pub cron: String,
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
}

impl RoutinesRuntime {
    fn new() -> Self {
        Self {
            io: Mutex::new(()),
            tx: Mutex::new(None),
            cancel: Mutex::new(None),
            epoch: AtomicU64::new(0),
            running: Mutex::new(None),
        }
    }

    fn bump_epoch(&self) -> u64 {
        let epoch = self.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        *self.running.lock() = None;
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
        execute_empty(app, root, epoch, cancel, &job).await;
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

async fn execute_empty(
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
    let _ = app.emit(
        "routine-run",
        RoutineRunEvent {
            id: job.id.clone(),
            phase: "started".into(),
            epoch,
        },
    );

    tokio::select! {
        _ = cancel.cancelled() => {
            runtime().set_running(epoch, None);
            if runtime().epoch() == epoch {
                let _ = app.emit(
                    "routine-run",
                    RoutineRunEvent {
                        id: job.id.clone(),
                        phase: "finished".into(),
                        epoch,
                    },
                );
            }
            return;
        }
        _ = tokio::time::sleep(EMPTY_HOLD) => {}
    }

    if runtime().epoch() != epoch {
        return;
    }

    {
        let _io = runtime().io.lock();
        if let Err(err) = append_run(root, &job.id, job.trigger, Local::now()) {
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
            },
        );
    }
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

fn next_from_cron(cron: &str, after: &DateTime<Local>) -> Result<String, String> {
    let schedule = parse_cron(cron)?;
    Ok(next_fire(&schedule, after)?.to_rfc3339())
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

fn append_run(
    root: &Path,
    id: &str,
    trigger: RunTrigger,
    at: DateTime<Local>,
) -> Result<(), String> {
    let doc = read_routine(root, id)?;
    let dir = root.join(&doc.folder);
    write_run_file(&dir, at, trigger)?;
    Ok(())
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
        write_run_file(&dir, at, run.trigger)?;
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

fn write_run_file(dir: &Path, at: DateTime<Local>, trigger: RunTrigger) -> Result<(), String> {
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
    let body = format!("# {display}\n\n- Trigger: {trigger_name}\n- Status: ok\n");
    fs::write(dir.join(name), body).map_err(|err| err.to_string())
}

fn list_run_files(root: &Path, folder: &str) -> Result<Vec<RoutineRunFile>, String> {
    if !routines_child(folder) {
        return Ok(Vec::new());
    }
    let dir = root.join(folder);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
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
        files.push(RoutineRunFile {
            path: format!("{folder}/{file_name}"),
            at: display_stamp(&stamp),
            trigger,
        });
    }
    files.sort_by(|a, b| b.path.cmp(&a.path));
    Ok(files)
}

fn upsert(root: &Path, input: UpsertRoutineArgs, now: DateTime<Local>) -> Result<Routine, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Name is required".into());
    }
    let name: String = name.chars().take(MAX_NAME_CHARS).collect();
    let cron = input.cron.trim().to_string();
    parse_cron(&cron)?;

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
    let doc = Routine {
        id,
        name,
        enabled: false,
        cron,
        folder,
        next_run_at,
        runs: Vec::new(),
    };
    write_routine(root, &doc)?;
    Ok(doc)
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
            UpsertRoutineArgs {
                id: None,
                name: "Broken".into(),
                cron: "nope".into(),
            },
            Local::now(),
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("cron") || err.contains("field"));
        assert!(read_all(&root).unwrap().is_empty());

        let err = upsert(
            &root,
            UpsertRoutineArgs {
                id: None,
                name: "Short".into(),
                cron: "0 9 * *".into(),
            },
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
            UpsertRoutineArgs {
                id: Some("daily".into()),
                name: "Daily".into(),
                cron: "0 9 * * *".into(),
            },
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
            UpsertRoutineArgs {
                id: Some("off".into()),
                name: "Off".into(),
                cron: "0 * * * *".into(),
            },
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
            UpsertRoutineArgs {
                id: Some("job".into()),
                name: "Morning".into(),
                cron: "0 9 * * *".into(),
            },
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
}
