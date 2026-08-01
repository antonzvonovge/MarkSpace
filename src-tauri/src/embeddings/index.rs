use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::model::{EMBEDDING_DIM, MODEL_ID};

pub const INDEX_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkRecord {
    pub heading: Option<String>,
    pub snippet: String,
    pub start_line: u32,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub content_hash: String,
    pub chunks: Vec<ChunkRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingIndex {
    pub version: u32,
    pub model_id: String,
    pub dim: u32,
    pub files: HashMap<String, FileRecord>,
}

impl EmbeddingIndex {
    pub fn fresh() -> Self {
        Self {
            version: INDEX_VERSION,
            model_id: MODEL_ID.to_string(),
            dim: EMBEDDING_DIM as u32,
            files: HashMap::new(),
        }
    }

    pub fn is_compatible(&self) -> bool {
        self.version == INDEX_VERSION
            && self.model_id == MODEL_ID
            && self.dim == EMBEDDING_DIM as u32
    }
}

pub fn vault_key(vault_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(vault_path.as_bytes());
    let digest = hasher.finalize();
    digest[..16]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn index_dir(app_data: &Path, vault_path: &str) -> PathBuf {
    app_data.join("embeddings").join(vault_key(vault_path))
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.bin")
}

pub fn load_index(dir: &Path) -> EmbeddingIndex {
    let path = index_path(dir);
    let Ok(bytes) = fs::read(&path) else {
        return EmbeddingIndex::fresh();
    };
    match bincode::deserialize::<EmbeddingIndex>(&bytes) {
        Ok(idx) if idx.is_compatible() => idx,
        _ => EmbeddingIndex::fresh(),
    }
}

pub fn save_index(dir: &Path, index: &EmbeddingIndex) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create embeddings dir: {e}"))?;
    let bytes =
        bincode::serialize(index).map_err(|e| format!("Cannot serialize embeddings index: {e}"))?;
    let path = index_path(dir);
    let tmp = dir.join("index.bin.tmp");
    fs::write(&tmp, &bytes).map_err(|e| format!("Cannot write embeddings index: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Cannot finalize embeddings index: {e}"))?;
    Ok(())
}

pub fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// True when the saved embeddings for `rel` still match the file on disk.
pub fn is_indexed(index: &EmbeddingIndex, rel: &str, content: &str) -> bool {
    index
        .files
        .get(rel)
        .map(|rec| rec.content_hash == content_hash(content))
        .unwrap_or(false)
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(content: &str) -> FileRecord {
        FileRecord {
            content_hash: content_hash(content),
            chunks: vec![ChunkRecord {
                heading: Some("A".into()),
                snippet: content.into(),
                start_line: 1,
                embedding: vec![0.1; 384],
            }],
        }
    }

    #[test]
    fn saved_index_survives_restart() {
        let dir = std::env::temp_dir().join(format!("markspace-idx-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let mut index = EmbeddingIndex::fresh();
        index.files.insert("Note.md".into(), record("hello"));
        save_index(&dir, &index).expect("save");

        let loaded = load_index(&dir);
        assert_eq!(loaded.files.len(), 1);
        assert!(is_indexed(&loaded, "Note.md", "hello"));
        assert!(!is_indexed(&loaded, "Note.md", "hello edited"));
        assert!(!is_indexed(&loaded, "Other.md", "hello"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn incompatible_index_is_discarded() {
        let dir = std::env::temp_dir().join(format!("markspace-idx-old-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let mut index = EmbeddingIndex::fresh();
        index.version = INDEX_VERSION + 1;
        index.files.insert("Note.md".into(), record("hello"));
        save_index(&dir, &index).expect("save");

        assert!(load_index(&dir).files.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }
}
