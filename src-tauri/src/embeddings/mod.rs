//! Local semantic embeddings (Candle + multilingual MiniLM) in a sidecar process.
//! Index lives under app_data, never inside the vault.
//!
//! Candle/tokenizers are compiled only with the `embeddings-sidecar` feature
//! (the `markspace-embeddings` binary). The main app hosts that process over IPC.

#[cfg(feature = "embeddings-sidecar")]
mod chunk;
pub mod download;
pub mod host;
#[cfg(feature = "embeddings-sidecar")]
mod index;
mod ipc;
#[cfg(feature = "embeddings-sidecar")]
mod model;
#[cfg(feature = "embeddings-sidecar")]
pub mod service;
mod types;

pub use host::{
    flush_index, notify_file_changed, notify_file_removed, notify_file_renamed,
    notify_indexing_policy, notify_model_available, notify_vault_opened, start_embeddings_runtime,
};
#[cfg(feature = "embeddings-sidecar")]
pub use service::run_stdio_server;
pub use types::{BackgroundJobPayload, EmbeddingsIndexStatus, SemanticHit};
