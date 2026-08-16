//! MCP client host: stdio + streamable HTTP via `rmcp`.
//!
//! Global server list is supplied by the frontend (Tauri store). Vault servers
//! live in `{vault}/.markspace/mcp.json`. Vault ids override global ids.

use crate::vault::{get_root, VaultState};
use http::{HeaderName, HeaderValue};
use rmcp::{
    ServiceExt,
    model::CallToolRequestParams,
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;

const EVENT_STATUS: &str = "mcp://status";
const MAX_SERVERS: usize = 32;
const MAX_ID_CHARS: usize = 64;
const MAX_COMMAND_CHARS: usize = 512;
const MAX_URL_CHARS: usize = 2048;
const MAX_ARGS: usize = 32;
const MAX_ENV: usize = 32;
const MAX_HEADERS: usize = 16;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_TOOLS: usize = 128;

const SPECIALIST_KINDS: &[&str] = &[
    "research",
    "edit_notes",
    "diagram",
    "links",
    "dict",
    "habits",
    "terminal",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum McpScope {
    Global,
    Vault,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum McpStatus {
    Connecting,
    Connected,
    Failed,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpUseIn {
    Always,
    Specialists(Vec<String>),
}

impl Serialize for McpUseIn {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            McpUseIn::Always => serializer.serialize_str("always"),
            McpUseIn::Specialists(kinds) => kinds.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for McpUseIn {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        Ok(normalize_use_in(&value))
    }
}

impl Default for McpUseIn {
    fn default() -> Self {
        McpUseIn::Always
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub use_in: McpUseIn,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub env: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub headers: HashMap<String, String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSnapshot {
    #[serde(flatten)]
    pub config: McpServerConfig,
    pub scope: McpScope,
    pub status: McpStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub tools: Vec<McpToolInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpDoc {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerConfig>,
}

fn default_version() -> u32 {
    1
}

enum SessionCmd {
    Call {
        name: String,
        args: Value,
        reply: oneshot::Sender<Result<Value, String>>,
    },
    Shutdown,
}

struct SessionHandle {
    tx: mpsc::Sender<SessionCmd>,
}

struct McpInner {
    global: Vec<McpServerConfig>,
    vault: Vec<McpServerConfig>,
    snapshots: HashMap<String, McpServerSnapshot>,
    sessions: HashMap<String, SessionHandle>,
}

pub struct McpRuntime {
    inner: Mutex<McpInner>,
}

impl Default for McpRuntime {
    fn default() -> Self {
        Self {
            inner: Mutex::new(McpInner {
                global: Vec::new(),
                vault: Vec::new(),
                snapshots: HashMap::new(),
                sessions: HashMap::new(),
            }),
        }
    }
}

fn is_safe_id(id: &str) -> bool {
    let t = id.trim();
    !t.is_empty()
        && t.len() <= MAX_ID_CHARS
        && t.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn is_specialist_kind(value: &str) -> bool {
    SPECIALIST_KINDS.contains(&value)
}

fn normalize_use_in(value: &Value) -> McpUseIn {
    match value {
        Value::String(s) if s.trim().eq_ignore_ascii_case("always") => McpUseIn::Always,
        Value::Array(items) => {
            let mut kinds = Vec::new();
            for item in items {
                let Some(raw) = item.as_str() else { continue };
                let kind = raw.trim();
                if is_specialist_kind(kind) && !kinds.iter().any(|k: &String| k == kind) {
                    kinds.push(kind.to_string());
                }
            }
            if kinds.is_empty() {
                McpUseIn::Always
            } else {
                McpUseIn::Specialists(kinds)
            }
        }
        _ => McpUseIn::Always,
    }
}

fn clip_map(raw: &Map<String, Value>, max: usize) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (k, v) in raw {
        if out.len() >= max {
            break;
        }
        let key = k.trim();
        if key.is_empty() || key.len() > 128 {
            continue;
        }
        let Some(val) = v.as_str() else { continue };
        out.insert(key.to_string(), val.to_string());
    }
    out
}

fn normalize_server(id: &str, raw: &Value) -> Option<McpServerConfig> {
    if !is_safe_id(id) {
        return None;
    }
    let obj = raw.as_object()?;
    let enabled = obj.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    let use_in = obj
        .get("useIn")
        .map(normalize_use_in)
        .unwrap_or(McpUseIn::Always);
    let command = obj
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= MAX_COMMAND_CHARS)
        .map(str::to_string);
    let url = obj
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= MAX_URL_CHARS)
        .map(str::to_string);
    if command.is_none() && url.is_none() {
        return None;
    }
    let args = obj
        .get("args")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty() && s.len() <= MAX_COMMAND_CHARS)
                .map(str::to_string)
                .take(MAX_ARGS)
                .collect()
        })
        .unwrap_or_default();
    let env = obj
        .get("env")
        .and_then(Value::as_object)
        .map(|m| clip_map(m, MAX_ENV))
        .unwrap_or_default();
    let headers = obj
        .get("headers")
        .and_then(Value::as_object)
        .map(|m| clip_map(m, MAX_HEADERS))
        .unwrap_or_default();
    Some(McpServerConfig {
        id: id.trim().to_string(),
        enabled,
        use_in,
        command,
        args,
        env,
        url,
        headers,
    })
}

fn servers_from_map(map: &Map<String, Value>) -> Vec<McpServerConfig> {
    let mut out = Vec::new();
    for (id, raw) in map {
        if out.len() >= MAX_SERVERS {
            break;
        }
        if let Some(cfg) = normalize_server(id, raw) {
            out.push(cfg);
        }
    }
    out
}

fn servers_from_array(arr: &[Value]) -> Vec<McpServerConfig> {
    let mut out = Vec::new();
    for item in arr {
        if out.len() >= MAX_SERVERS {
            break;
        }
        let Some(obj) = item.as_object() else { continue };
        let Some(id) = obj.get("id").and_then(Value::as_str) else {
            continue;
        };
        if let Some(cfg) = normalize_server(id, item) {
            out.push(cfg);
        }
    }
    out
}

pub fn parse_mcp_doc(raw: &str) -> Result<McpDoc, String> {
    if raw.trim().is_empty() {
        return Ok(McpDoc::default());
    }
    let value: Value = serde_json::from_str(raw).map_err(|e| format!("Invalid mcp.json: {e}"))?;
    Ok(normalize_doc(&value))
}

fn normalize_doc(value: &Value) -> McpDoc {
    let mcp_servers = match value {
        Value::Object(obj) => {
            if let Some(map) = obj.get("mcpServers").and_then(Value::as_object) {
                servers_from_map(map)
            } else if let Some(arr) = obj.get("mcpServers").and_then(Value::as_array) {
                servers_from_array(arr)
            } else if let Some(arr) = obj.get("servers").and_then(Value::as_array) {
                servers_from_array(arr)
            } else {
                Vec::new()
            }
        }
        Value::Array(arr) => servers_from_array(arr),
        _ => Vec::new(),
    };
    McpDoc {
        version: 1,
        mcp_servers,
    }
}

fn normalize_incoming_servers(raw: Vec<McpServerConfig>) -> Vec<McpServerConfig> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for cfg in raw {
        if out.len() >= MAX_SERVERS {
            break;
        }
        let value = serde_json::to_value(&cfg).unwrap_or(Value::Null);
        let Some(normalized) = normalize_server(&cfg.id, &value) else {
            continue;
        };
        if !seen.insert(normalized.id.clone()) {
            continue;
        }
        out.push(normalized);
    }
    out
}

fn doc_to_file_json(doc: &McpDoc) -> Result<String, String> {
    let mut map = serde_json::Map::new();
    for server in &doc.mcp_servers {
        let mut entry = serde_json::Map::new();
        entry.insert("enabled".into(), Value::Bool(server.enabled));
        entry.insert(
            "useIn".into(),
            serde_json::to_value(&server.use_in).unwrap_or(Value::String("always".into())),
        );
        if let Some(command) = &server.command {
            entry.insert("command".into(), Value::String(command.clone()));
        }
        if !server.args.is_empty() {
            entry.insert(
                "args".into(),
                Value::Array(server.args.iter().cloned().map(Value::String).collect()),
            );
        }
        if !server.env.is_empty() {
            let env = server
                .env
                .iter()
                .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                .collect();
            entry.insert("env".into(), Value::Object(env));
        }
        if let Some(url) = &server.url {
            entry.insert("url".into(), Value::String(url.clone()));
        }
        if !server.headers.is_empty() {
            let headers = server
                .headers
                .iter()
                .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                .collect();
            entry.insert("headers".into(), Value::Object(headers));
        }
        map.insert(server.id.clone(), Value::Object(entry));
    }
    let body = serde_json::json!({
        "version": 1,
        "mcpServers": Value::Object(map),
    });
    serde_json::to_string_pretty(&body)
        .map(|s| format!("{s}\n"))
        .map_err(|e| e.to_string())
}

fn vault_mcp_path(root: &Path) -> PathBuf {
    root.join(".markspace").join("mcp.json")
}

fn load_vault_doc(root: &Path) -> Result<McpDoc, String> {
    let path = vault_mcp_path(root);
    if !path.exists() {
        return Ok(McpDoc::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    parse_mcp_doc(&raw)
}

fn save_vault_doc(root: &Path, doc: &McpDoc) -> Result<(), String> {
    let markspace = root.join(".markspace");
    std::fs::create_dir_all(&markspace).map_err(|e| e.to_string())?;
    std::fs::write(vault_mcp_path(root), doc_to_file_json(doc)?).map_err(|e| e.to_string())
}

fn merge_servers(
    global: &[McpServerConfig],
    vault: &[McpServerConfig],
) -> Vec<(McpScope, McpServerConfig)> {
    let mut out: Vec<(McpScope, McpServerConfig)> = Vec::new();
    let vault_ids: HashSet<&str> = vault.iter().map(|s| s.id.as_str()).collect();
    for cfg in global {
        if vault_ids.contains(cfg.id.as_str()) {
            continue;
        }
        out.push((McpScope::Global, cfg.clone()));
    }
    for cfg in vault {
        out.push((McpScope::Vault, cfg.clone()));
    }
    out
}

fn fingerprint(cfg: &McpServerConfig) -> String {
    format!(
        "{}|{}|{}|{:?}|{:?}|{:?}|{:?}|{:?}",
        cfg.id,
        cfg.enabled,
        serde_json::to_string(&cfg.use_in).unwrap_or_default(),
        cfg.command,
        cfg.args,
        cfg.env,
        cfg.url,
        cfg.headers
    )
}

fn snapshot_list(inner: &McpInner) -> Vec<McpServerSnapshot> {
    let mut list: Vec<McpServerSnapshot> = inner.snapshots.values().cloned().collect();
    list.sort_by(|a, b| a.config.id.cmp(&b.config.id));
    list
}

async fn emit_status(app: &AppHandle, runtime: &McpRuntime) {
    let inner = runtime.inner.lock().await;
    let _ = app.emit(EVENT_STATUS, snapshot_list(&inner));
}

async fn shutdown_session(handle: SessionHandle) {
    let _ = handle.tx.send(SessionCmd::Shutdown).await;
}

async fn open_session(
    cfg: McpServerConfig,
    cwd: Option<PathBuf>,
) -> Result<(SessionHandle, Vec<McpToolInfo>), String> {
    let (tx, mut rx) = mpsc::channel::<SessionCmd>(8);
    let (ready_tx, ready_rx) = oneshot::channel::<Result<Vec<McpToolInfo>, String>>();

    tokio::spawn(async move {
        let outcome = timeout(CONNECT_TIMEOUT, start_client(&cfg, cwd.as_deref())).await;
        match outcome {
            Ok(Ok(mut client)) => {
                let listed = match client.list_tools(None).await {
                    Ok(list) => list
                        .tools
                        .iter()
                        .take(MAX_TOOLS)
                        .map(|tool| McpToolInfo {
                            name: tool.name.to_string(),
                            description: tool
                                .description
                                .as_ref()
                                .map(|d| d.to_string())
                                .unwrap_or_default(),
                            input_schema: Value::Object((*tool.input_schema).clone()),
                        })
                        .collect::<Vec<_>>(),
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("tools/list failed: {e}")));
                        let _ = client.close().await;
                        return;
                    }
                };
                let _ = ready_tx.send(Ok(listed));
                while let Some(cmd) = rx.recv().await {
                    match cmd {
                        SessionCmd::Shutdown => break,
                        SessionCmd::Call { name, args, reply } => {
                            let mut params = CallToolRequestParams::new(name);
                            if let Some(obj) = args.as_object() {
                                params = params.with_arguments(obj.clone());
                            }
                            let result = timeout(CALL_TIMEOUT, client.call_tool(params)).await;
                            let payload = match result {
                                Ok(Ok(value)) => Ok(serde_json::to_value(&value).unwrap_or_else(
                                    |_| {
                                        serde_json::json!({
                                            "isError": true,
                                            "content": [{
                                                "type": "text",
                                                "text": "Failed to serialize MCP result"
                                            }],
                                        })
                                    },
                                )),
                                Ok(Err(e)) => Err(format!("MCP tool failed: {e}")),
                                Err(_) => Err("MCP tool timed out".into()),
                            };
                            let _ = reply.send(payload);
                        }
                    }
                }
                let _ = client.close().await;
            }
            Ok(Err(e)) => {
                let _ = ready_tx.send(Err(e));
            }
            Err(_) => {
                let _ = ready_tx.send(Err("Timed out connecting to MCP server".into()));
            }
        }
    });

    match ready_rx.await {
        Ok(Ok(tools)) => Ok((SessionHandle { tx }, tools)),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("MCP session task ended".into()),
    }
}

async fn start_client(
    cfg: &McpServerConfig,
    cwd: Option<&Path>,
) -> Result<rmcp::service::RunningService<rmcp::RoleClient, ()>, String> {
    if let Some(url) = cfg.url.as_ref().filter(|u| !u.is_empty()) {
        let mut headers = HashMap::new();
        for (k, v) in &cfg.headers {
            let name = HeaderName::try_from(k.as_str())
                .map_err(|e| format!("Invalid header name {k}: {e}"))?;
            let value = HeaderValue::try_from(v.as_str())
                .map_err(|e| format!("Invalid header value for {k}: {e}"))?;
            headers.insert(name, value);
        }
        let config =
            StreamableHttpClientTransportConfig::with_uri(url.clone()).custom_headers(headers);
        let transport = StreamableHttpClientTransport::from_config(config);
        return ().serve(transport)
            .await
            .map_err(|e| format!("MCP HTTP handshake failed: {e}"));
    }

    let command = cfg
        .command
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "MCP server needs a command or a URL".to_string())?;

    let mut cmd = Command::new(command);
    cmd.args(&cfg.args);
    cmd.envs(std::env::vars());
    for (k, v) in &cfg.env {
        cmd.env(k, v);
    }
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stderr(std::process::Stdio::inherit());
    let transport = TokioChildProcess::new(cmd)
        .map_err(|e| format!("Failed to start `{command}`: {e}"))?;
    ().serve(transport)
        .await
        .map_err(|e| format!("MCP stdio handshake failed: {e}"))
}

fn disabled_snapshot(scope: McpScope, cfg: McpServerConfig) -> McpServerSnapshot {
    McpServerSnapshot {
        config: cfg,
        scope,
        status: McpStatus::Disabled,
        error: None,
        tools: Vec::new(),
    }
}

fn connecting_snapshot(scope: McpScope, cfg: McpServerConfig) -> McpServerSnapshot {
    McpServerSnapshot {
        config: cfg,
        scope,
        status: McpStatus::Connecting,
        error: None,
        tools: Vec::new(),
    }
}

fn failed_snapshot(scope: McpScope, cfg: McpServerConfig, error: String) -> McpServerSnapshot {
    McpServerSnapshot {
        config: cfg,
        scope,
        status: McpStatus::Failed,
        error: Some(error),
        tools: Vec::new(),
    }
}

fn connected_snapshot(
    scope: McpScope,
    cfg: McpServerConfig,
    tools: Vec<McpToolInfo>,
) -> McpServerSnapshot {
    McpServerSnapshot {
        config: cfg,
        scope,
        status: McpStatus::Connected,
        error: None,
        tools,
    }
}

async fn reconcile(
    app: &AppHandle,
    runtime: &McpRuntime,
    vault_root: Option<PathBuf>,
    reload_ids: Option<HashSet<String>>,
) {
    let desired = {
        let inner = runtime.inner.lock().await;
        merge_servers(&inner.global, &inner.vault)
    };

    let desired_ids: HashSet<String> = desired.iter().map(|(_, c)| c.id.clone()).collect();
    let stale: Vec<SessionHandle> = {
        let mut inner = runtime.inner.lock().await;
        let stale_ids: Vec<String> = inner
            .sessions
            .keys()
            .filter(|id| !desired_ids.contains(*id))
            .cloned()
            .collect();
        let mut handles = Vec::new();
        for id in stale_ids {
            if let Some(handle) = inner.sessions.remove(&id) {
                handles.push(handle);
            }
            inner.snapshots.remove(&id);
        }
        handles
    };
    for handle in stale {
        shutdown_session(handle).await;
    }

    let mut to_start: Vec<(McpScope, McpServerConfig)> = Vec::new();
    {
        let mut inner = runtime.inner.lock().await;
        for (scope, cfg) in desired {
            if !cfg.enabled {
                if let Some(handle) = inner.sessions.remove(&cfg.id) {
                    drop(inner);
                    shutdown_session(handle).await;
                    inner = runtime.inner.lock().await;
                }
                inner
                    .snapshots
                    .insert(cfg.id.clone(), disabled_snapshot(scope, cfg));
                continue;
            }

            let force = reload_ids
                .as_ref()
                .map(|set| set.contains(&cfg.id))
                .unwrap_or(false);
            let already = inner.sessions.contains_key(&cfg.id);
            let same = inner
                .snapshots
                .get(&cfg.id)
                .map(|snap| {
                    snap.status == McpStatus::Connected && fingerprint(&snap.config) == fingerprint(&cfg)
                })
                .unwrap_or(false);
            if already && same && !force {
                inner.snapshots.entry(cfg.id.clone()).and_modify(|snap| {
                    snap.config = cfg.clone();
                    snap.scope = scope.clone();
                });
                continue;
            }
            if let Some(handle) = inner.sessions.remove(&cfg.id) {
                drop(inner);
                shutdown_session(handle).await;
                inner = runtime.inner.lock().await;
            }
            inner
                .snapshots
                .insert(cfg.id.clone(), connecting_snapshot(scope.clone(), cfg.clone()));
            to_start.push((scope, cfg));
        }
    }
    emit_status(app, runtime).await;

    for (scope, cfg) in to_start {
        let id = cfg.id.clone();
        match open_session(cfg.clone(), vault_root.clone()).await {
            Ok((handle, tools)) => {
                let mut inner = runtime.inner.lock().await;
                inner.sessions.insert(id.clone(), handle);
                inner
                    .snapshots
                    .insert(id, connected_snapshot(scope, cfg, tools));
            }
            Err(error) => {
                let mut inner = runtime.inner.lock().await;
                inner
                    .snapshots
                    .insert(id, failed_snapshot(scope, cfg, error));
            }
        }
        emit_status(app, runtime).await;
    }
}

#[tauri::command]
pub async fn mcp_list_snapshot(runtime: State<'_, McpRuntime>) -> Result<Vec<McpServerSnapshot>, String> {
    let inner = runtime.inner.lock().await;
    Ok(snapshot_list(&inner))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSyncArgs {
    #[serde(default)]
    pub global_servers: Vec<McpServerConfig>,
}

#[tauri::command]
pub async fn mcp_sync(
    app: AppHandle,
    runtime: State<'_, McpRuntime>,
    vault: State<'_, VaultState>,
    args: McpSyncArgs,
) -> Result<Vec<McpServerSnapshot>, String> {
    let global = normalize_incoming_servers(args.global_servers);
    let vault_root = get_root(&vault).ok();
    let vault_doc = if let Some(root) = vault_root.as_ref() {
        load_vault_doc(root)?
    } else {
        McpDoc::default()
    };
    {
        let mut inner = runtime.inner.lock().await;
        inner.global = global;
        inner.vault = vault_doc.mcp_servers;
        if vault_root.is_none() {
            inner.vault.clear();
        }
    }
    reconcile(&app, &runtime, vault_root, None).await;
    let inner = runtime.inner.lock().await;
    Ok(snapshot_list(&inner))
}

#[tauri::command]
pub fn mcp_get_vault(vault: State<'_, VaultState>) -> Result<McpDoc, String> {
    let root = get_root(&vault)?;
    load_vault_doc(&root)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSetVaultArgs {
    #[serde(default)]
    pub servers: Vec<McpServerConfig>,
}

#[tauri::command]
pub async fn mcp_set_vault(
    app: AppHandle,
    runtime: State<'_, McpRuntime>,
    vault: State<'_, VaultState>,
    args: McpSetVaultArgs,
) -> Result<McpDoc, String> {
    let root = get_root(&vault)?;
    let doc = McpDoc {
        version: 1,
        mcp_servers: normalize_incoming_servers(args.servers),
    };
    save_vault_doc(&root, &doc)?;
    {
        let mut inner = runtime.inner.lock().await;
        inner.vault = doc.mcp_servers.clone();
    }
    reconcile(&app, &runtime, Some(root), None).await;
    Ok(doc)
}

#[tauri::command]
pub async fn mcp_reload(
    app: AppHandle,
    runtime: State<'_, McpRuntime>,
    vault: State<'_, VaultState>,
) -> Result<Vec<McpServerSnapshot>, String> {
    let vault_root = get_root(&vault).ok();
    let ids: HashSet<String> = {
        let inner = runtime.inner.lock().await;
        merge_servers(&inner.global, &inner.vault)
            .into_iter()
            .filter(|(_, cfg)| cfg.enabled)
            .map(|(_, cfg)| cfg.id)
            .collect()
    };
    reconcile(&app, &runtime, vault_root, Some(ids)).await;
    let inner = runtime.inner.lock().await;
    Ok(snapshot_list(&inner))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpReloadServerArgs {
    pub id: String,
}

#[tauri::command]
pub async fn mcp_reload_server(
    app: AppHandle,
    runtime: State<'_, McpRuntime>,
    vault: State<'_, VaultState>,
    args: McpReloadServerArgs,
) -> Result<Vec<McpServerSnapshot>, String> {
    let id = args.id.trim().to_string();
    if !is_safe_id(&id) {
        return Err("Invalid MCP server id".into());
    }
    let vault_root = get_root(&vault).ok();
    let mut ids = HashSet::new();
    ids.insert(id);
    reconcile(&app, &runtime, vault_root, Some(ids)).await;
    let inner = runtime.inner.lock().await;
    Ok(snapshot_list(&inner))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallToolArgs {
    pub server_id: String,
    pub tool_name: String,
    #[serde(default)]
    pub arguments: Value,
}

#[tauri::command]
pub async fn mcp_call_tool(
    runtime: State<'_, McpRuntime>,
    args: McpCallToolArgs,
) -> Result<Value, String> {
    let server_id = args.server_id.trim();
    let tool_name = args.tool_name.trim();
    if !is_safe_id(server_id) {
        return Err("Invalid MCP server id".into());
    }
    if tool_name.is_empty() {
        return Err("MCP tool name is required".into());
    }
    let tx = {
        let inner = runtime.inner.lock().await;
        let snap = inner
            .snapshots
            .get(server_id)
            .ok_or_else(|| format!("Unknown MCP server `{server_id}`"))?;
        if snap.status != McpStatus::Connected {
            return Err(format!("MCP server `{server_id}` is not connected"));
        }
        inner
            .sessions
            .get(server_id)
            .ok_or_else(|| format!("MCP server `{server_id}` is not connected"))?
            .tx
            .clone()
    };
    let (reply_tx, reply_rx) = oneshot::channel();
    tx.send(SessionCmd::Call {
        name: tool_name.to_string(),
        args: args.arguments,
        reply: reply_tx,
    })
    .await
    .map_err(|_| format!("MCP server `{server_id}` is not connected"))?;
    reply_rx
        .await
        .map_err(|_| "MCP session ended".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cursor_style_map() {
        let raw = r#"{
            "mcpServers": {
                "github": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": { "GITHUB_TOKEN": "x" },
                    "useIn": ["research", "edit_notes"]
                }
            }
        }"#;
        let doc = parse_mcp_doc(raw).unwrap();
        assert_eq!(doc.mcp_servers.len(), 1);
        let s = &doc.mcp_servers[0];
        assert_eq!(s.id, "github");
        assert!(s.enabled);
        assert_eq!(s.command.as_deref(), Some("npx"));
        assert_eq!(
            s.use_in,
            McpUseIn::Specialists(vec!["research".into(), "edit_notes".into()])
        );
        assert_eq!(s.env.get("GITHUB_TOKEN").map(String::as_str), Some("x"));
    }

    #[test]
    fn vault_overrides_global_ids() {
        let global = vec![McpServerConfig {
            id: "github".into(),
            enabled: true,
            use_in: McpUseIn::Always,
            command: Some("npx".into()),
            args: vec![],
            env: HashMap::new(),
            url: None,
            headers: HashMap::new(),
        }];
        let vault = vec![McpServerConfig {
            id: "github".into(),
            enabled: false,
            use_in: McpUseIn::Always,
            command: Some("uvx".into()),
            args: vec![],
            env: HashMap::new(),
            url: None,
            headers: HashMap::new(),
        }];
        let merged = merge_servers(&global, &vault);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].0, McpScope::Vault);
        assert!(!merged[0].1.enabled);
        assert_eq!(merged[0].1.command.as_deref(), Some("uvx"));
    }

    #[test]
    fn drops_invalid_ids_and_empty_transport() {
        let raw = r#"{
            "mcpServers": {
                "../evil": { "command": "npx" },
                "ok": { "enabled": true },
                "web": { "url": "https://example.com/mcp", "useIn": "always" }
            }
        }"#;
        let doc = parse_mcp_doc(raw).unwrap();
        assert_eq!(doc.mcp_servers.len(), 1);
        assert_eq!(doc.mcp_servers[0].id, "web");
        assert_eq!(doc.mcp_servers[0].use_in, McpUseIn::Always);
    }

    #[test]
    fn round_trip_file_json() {
        let doc = McpDoc {
            version: 1,
            mcp_servers: vec![McpServerConfig {
                id: "docs".into(),
                enabled: true,
                use_in: McpUseIn::Always,
                command: None,
                args: vec![],
                env: HashMap::new(),
                url: Some("https://example.com/mcp".into()),
                headers: HashMap::from([("Authorization".into(), "Bearer x".into())]),
            }],
        };
        let raw = doc_to_file_json(&doc).unwrap();
        let loaded = parse_mcp_doc(&raw).unwrap();
        assert_eq!(loaded.mcp_servers[0].id, "docs");
        assert_eq!(
            loaded.mcp_servers[0].url.as_deref(),
            Some("https://example.com/mcp")
        );
        assert_eq!(
            loaded.mcp_servers[0]
                .headers
                .get("Authorization")
                .map(String::as_str),
            Some("Bearer x")
        );
    }
}
