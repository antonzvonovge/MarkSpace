//! Local in-process semantic embeddings (Candle + multilingual MiniLM).
//! Index lives under app_data, never inside the vault.

mod chunk;
pub mod download;
mod index;
mod model;
pub mod worker;

pub use worker::{
    flush_index, notify_file_changed, notify_file_removed, notify_file_renamed,
    notify_vault_opened, start_embeddings_runtime,
};
