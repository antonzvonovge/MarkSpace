use serde::{Deserialize, Serialize};

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
    /// Vault policy: when false, indexing and semantic search are off.
    #[serde(default = "default_true")]
    pub indexing_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn default_true() -> bool {
    true
}
