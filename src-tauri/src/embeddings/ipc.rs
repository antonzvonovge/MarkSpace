//! NDJSON protocol between the main process host and `markspace-embeddings`.

use serde::{Deserialize, Serialize};

use super::types::{BackgroundJobPayload, EmbeddingsIndexStatus, SemanticHit};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HostRequest {
    OpenVault {
        id: u64,
        vault_path: String,
        app_data: String,
        enabled: bool,
        delay_seconds: u32,
        #[serde(default)]
        pause_on_activity: bool,
    },
    ModelAvailable {
        id: u64,
        model_dir: String,
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
        id: u64,
        enabled: bool,
        delay_seconds: u32,
        #[serde(default)]
        pause_on_activity: bool,
    },
    /// Heartbeat: the user is typing or a chat stream is running. Fire-and-forget;
    /// the child expires it on its own so a wedged frontend cannot stall indexing.
    UserActivity,
    Search {
        id: u64,
        query: String,
        limit: usize,
    },
    Status {
        id: u64,
    },
    Flush {
        id: u64,
    },
    Shutdown {
        id: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChildMessage {
    Ack {
        id: u64,
    },
    SearchResult {
        id: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hits: Option<Vec<SemanticHit>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    StatusResult {
        id: u64,
        status: EmbeddingsIndexStatus,
    },
    FlushDone {
        id: u64,
    },
    ShutdownDone {
        id: u64,
    },
    Job {
        payload: BackgroundJobPayload,
    },
    Error {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
        message: String,
    },
}
