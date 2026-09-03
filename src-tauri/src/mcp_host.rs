//! MarkSpace MCP host: Streamable HTTP server on localhost that forwards
//! task tool calls to the frontend via Tauri events.

use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, StatusCode},
    middleware::{self, Next},
    response::Response,
    Router,
};
use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ErrorData as McpError,
        JsonObject, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    RoleServer,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State as TauriState};
use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

const EVENT_CALL: &str = "mcp-host://call";
const CALL_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_PORT: u16 = 17832;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHostToolDef {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHostCallPayload {
    pub request_id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHostStatus {
    pub enabled: bool,
    pub listening: bool,
    pub bridge_ready: bool,
    pub port: u16,
    pub url: String,
    pub token_set: bool,
    pub error: Option<String>,
}

struct PendingCall {
    reply: oneshot::Sender<Result<Value, String>>,
}

struct HostInner {
    enabled: bool,
    listening: bool,
    bridge_ready: bool,
    port: u16,
    token: String,
    error: Option<String>,
    tools: Vec<Tool>,
    pending: HashMap<String, PendingCall>,
    cancel: Option<CancellationToken>,
    app: Option<AppHandle>,
}

pub struct McpHostRuntime {
    inner: Mutex<HostInner>,
}

impl Default for McpHostRuntime {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HostInner {
                enabled: false,
                listening: false,
                bridge_ready: false,
                port: DEFAULT_PORT,
                token: String::new(),
                error: None,
                tools: Vec::new(),
                pending: HashMap::new(),
                cancel: None,
                app: None,
            }),
        }
    }
}

fn status_from(inner: &HostInner) -> McpHostStatus {
    McpHostStatus {
        enabled: inner.enabled,
        listening: inner.listening,
        bridge_ready: inner.bridge_ready,
        port: inner.port,
        url: format!("http://127.0.0.1:{}/mcp", inner.port),
        token_set: !inner.token.is_empty(),
        error: inner.error.clone(),
    }
}

fn value_to_schema(value: Value) -> Arc<JsonObject> {
    match value {
        Value::Object(map) => Arc::new(map),
        _ => Arc::new(Map::new()),
    }
}

fn tool_from_def(def: &McpHostToolDef) -> Tool {
    Tool::new(
        def.name.clone(),
        def.description.clone(),
        value_to_schema(def.input_schema.clone()),
    )
}

fn new_request_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("mcp-{nanos}-{}", fastrand_u32())
}

fn fastrand_u32() -> u32 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    std::time::Instant::now().hash(&mut h);
    std::thread::current().id().hash(&mut h);
    h.finish() as u32
}

#[derive(Clone)]
struct TasksMcpServer {
    runtime: Arc<McpHostRuntime>,
}

impl TasksMcpServer {
    async fn tools_snapshot(&self) -> Vec<Tool> {
        self.runtime.inner.lock().await.tools.clone()
    }

    async fn dispatch_tool(
        &self,
        name: &str,
        arguments: Option<JsonObject>,
    ) -> Result<Value, String> {
        let (request_id, app) = {
            let inner = self.runtime.inner.lock().await;
            if !inner.bridge_ready {
                return Err(
                    "MarkSpace MCP bridge is not ready (open a vault and keep the app running)"
                        .into(),
                );
            }
            let Some(app) = inner.app.clone() else {
                return Err("MarkSpace MCP host is not attached to the app".into());
            };
            (new_request_id(), app)
        };

        let (tx, rx) = oneshot::channel();
        {
            let mut inner = self.runtime.inner.lock().await;
            inner
                .pending
                .insert(request_id.clone(), PendingCall { reply: tx });
        }

        let payload = McpHostCallPayload {
            request_id: request_id.clone(),
            name: name.to_string(),
            arguments: Value::Object(arguments.unwrap_or_default()),
        };
        if let Err(e) = app.emit(EVENT_CALL, &payload) {
            let mut inner = self.runtime.inner.lock().await;
            inner.pending.remove(&request_id);
            return Err(format!("Failed to emit MCP tool call: {e}"));
        }

        match tokio::time::timeout(CALL_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("MCP tool call channel closed".into()),
            Err(_) => {
                let mut inner = self.runtime.inner.lock().await;
                inner.pending.remove(&request_id);
                Err("MCP tool call timed out waiting for MarkSpace UI".into())
            }
        }
    }
}

impl ServerHandler for TasksMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions(
                "MarkSpace Tasks MCP host. Create and edit vault Tasks/ notes while MarkSpace is running.",
            )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let tools = self.tools_snapshot().await;
        Ok(ListToolsResult {
            tools,
            ..Default::default()
        })
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.runtime
            .inner
            .try_lock()
            .ok()
            .and_then(|inner| inner.tools.iter().find(|t| t.name.as_ref() == name).cloned())
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let name = request.name.to_string();
        match self.dispatch_tool(&name, request.arguments).await {
            Ok(value) => Ok(CallToolResult::structured(value).into()),
            Err(msg) => Ok(CallToolResult::error(vec![ContentBlock::text(msg)]).into()),
        }
    }
}

#[derive(Clone)]
struct AuthState {
    token: String,
}

async fn require_bearer(
    State(auth): State<AuthState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Non-browser MCP clients rarely send OPTIONS; allow it through for CORS probes.
    if req.method() == axum::http::Method::OPTIONS {
        return Ok(next.run(req).await);
    }
    let header = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let expected = format!("Bearer {}", auth.token);
    if header == expected {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn stop_listener(inner: &mut HostInner) {
    if let Some(cancel) = inner.cancel.take() {
        cancel.cancel();
    }
    inner.listening = false;
}

async fn spawn_listener(
    runtime: Arc<McpHostRuntime>,
    app: AppHandle,
    port: u16,
    token: String,
) -> Result<(), String> {
    {
        let mut inner = runtime.inner.lock().await;
        stop_listener(&mut inner).await;
        inner.app = Some(app);
        inner.port = port;
        inner.token = token.clone();
        inner.error = None;
        inner.enabled = true;
    }

    let cancel = CancellationToken::new();
    let child = cancel.child_token();
    {
        let mut inner = runtime.inner.lock().await;
        inner.cancel = Some(cancel);
    }

    let server = TasksMcpServer {
        runtime: runtime.clone(),
    };
    let config = StreamableHttpServerConfig::default()
        .with_json_response(true)
        .with_sse_keep_alive(None)
        .with_cancellation_token(child.clone())
        .with_allowed_hosts([
            "127.0.0.1".to_string(),
            "localhost".to_string(),
            format!("127.0.0.1:{port}"),
            format!("localhost:{port}"),
        ]);

    let service = StreamableHttpService::new(
        move || Ok(server.clone()),
        Arc::new(LocalSessionManager::default()),
        config,
    );

    let auth = AuthState { token };
    let router = Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(auth, require_bearer));

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind MCP host on {addr}: {e}"))?;

    {
        let mut inner = runtime.inner.lock().await;
        inner.listening = true;
        inner.error = None;
    }

    let runtime_for_task = runtime.clone();
    tokio::spawn(async move {
        let serve = axum::serve(listener, router).with_graceful_shutdown(async move {
            child.cancelled().await;
        });
        if let Err(e) = serve.await {
            let mut inner = runtime_for_task.inner.lock().await;
            inner.listening = false;
            inner.error = Some(format!("MCP host server error: {e}"));
        } else {
            let mut inner = runtime_for_task.inner.lock().await;
            inner.listening = false;
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn mcp_host_get_status(
    runtime: TauriState<'_, Arc<McpHostRuntime>>,
) -> Result<McpHostStatus, String> {
    let inner = runtime.inner.lock().await;
    Ok(status_from(&inner))
}

#[tauri::command]
pub async fn mcp_host_start(
    app: AppHandle,
    runtime: TauriState<'_, Arc<McpHostRuntime>>,
    port: u16,
    token: String,
) -> Result<McpHostStatus, String> {
    if !(1024..=65535).contains(&port) {
        return Err("Port must be between 1024 and 65535".into());
    }
    let token = token.trim().to_string();
    if token.len() < 8 {
        return Err("Token must be at least 8 characters".into());
    }
    let rt = Arc::clone(&runtime);
    spawn_listener(rt, app, port, token).await?;
    let inner = runtime.inner.lock().await;
    Ok(status_from(&inner))
}

#[tauri::command]
pub async fn mcp_host_stop(
    runtime: TauriState<'_, Arc<McpHostRuntime>>,
) -> Result<McpHostStatus, String> {
    let mut inner = runtime.inner.lock().await;
    stop_listener(&mut inner).await;
    inner.enabled = false;
    Ok(status_from(&inner))
}

#[tauri::command]
pub async fn mcp_host_register_tools(
    runtime: TauriState<'_, Arc<McpHostRuntime>>,
    tools: Vec<McpHostToolDef>,
) -> Result<(), String> {
    let mut inner = runtime.inner.lock().await;
    inner.tools = tools.iter().map(tool_from_def).collect();
    Ok(())
}

#[tauri::command]
pub async fn mcp_host_set_bridge_ready(
    runtime: TauriState<'_, Arc<McpHostRuntime>>,
    ready: bool,
) -> Result<(), String> {
    let mut inner = runtime.inner.lock().await;
    inner.bridge_ready = ready;
    Ok(())
}

#[tauri::command]
pub async fn mcp_host_tool_result(
    runtime: TauriState<'_, Arc<McpHostRuntime>>,
    request_id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let mut inner = runtime.inner.lock().await;
    let Some(pending) = inner.pending.remove(&request_id) else {
        return Ok(());
    };
    let reply = if ok {
        Ok(result.unwrap_or(Value::Null))
    } else {
        Err(error.unwrap_or_else(|| "Tool failed".into()))
    };
    let _ = pending.reply.send(reply);
    Ok(())
}
