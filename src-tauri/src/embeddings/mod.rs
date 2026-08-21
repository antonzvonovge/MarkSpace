//! Local semantic embeddings (Candle + multilingual MiniLM) in a sidecar process.
//! Index lives under app_data, never inside the vault.

mod chunk;
pub mod download;
pub mod host;
mod index;
mod ipc;
mod model;
pub mod service;
mod types;

pub use host::{
    flush_index, notify_file_changed, notify_file_removed, notify_file_renamed,
    notify_indexing_policy, notify_model_available, notify_vault_opened, start_embeddings_runtime,
};
pub use service::run_stdio_server;
pub use types::{BackgroundJobPayload, EmbeddingsIndexStatus, SemanticHit};
