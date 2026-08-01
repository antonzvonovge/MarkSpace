use parking_lot::Mutex;
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};

use super::model::MODEL_ID;

const EVENT_NAME: &str = "embedding-model://progress";
const MODEL_BASE_URL: &str =
    "https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/main";
const MODEL_FILES: &[&str] = &[
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "model.safetensors",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingModelStatus {
    pub installed: bool,
    pub downloading: bool,
    pub progress: u32,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub model_id: String,
    pub error: Option<String>,
}

static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static STATUS: OnceLock<Mutex<EmbeddingModelStatus>> = OnceLock::new();

fn status_cell() -> &'static Mutex<EmbeddingModelStatus> {
    STATUS.get_or_init(|| {
        Mutex::new(EmbeddingModelStatus {
            installed: false,
            downloading: false,
            progress: 0,
            downloaded_bytes: 0,
            total_bytes: None,
            model_id: MODEL_ID.to_string(),
            error: None,
        })
    })
}

pub fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    Ok(base.join("models").join(MODEL_ID))
}

pub fn model_is_installed(dir: &Path) -> bool {
    MODEL_FILES.iter().all(|name| model_file_is_valid(dir, name))
}

fn model_file_is_valid(dir: &Path, name: &str) -> bool {
    let min_size = match name {
        "model.safetensors" => 400 * 1024 * 1024,
        "tokenizer.json" => 1024 * 1024,
        _ => 100,
    };
    dir.join(name)
        .metadata()
        .map(|m| m.is_file() && m.len() >= min_size)
        .unwrap_or(false)
}

fn current_status(app: &AppHandle) -> Result<EmbeddingModelStatus, String> {
    let dir = model_dir(app)?;
    let mut status = status_cell().lock().clone();
    status.installed = model_is_installed(&dir);
    status.downloading = DOWNLOADING.load(Ordering::SeqCst);
    if status.installed && !status.downloading {
        status.progress = 100;
        status.error = None;
    }
    Ok(status)
}

fn emit_status(app: &AppHandle, status: EmbeddingModelStatus) {
    *status_cell().lock() = status.clone();
    let _ = app.emit(EVENT_NAME, status);
}

#[tauri::command(async)]
pub fn get_embedding_model_status(app: AppHandle) -> Result<EmbeddingModelStatus, String> {
    current_status(&app)
}

#[tauri::command(async)]
pub fn download_embedding_model(app: AppHandle) -> Result<EmbeddingModelStatus, String> {
    let dir = model_dir(&app)?;
    if model_is_installed(&dir) {
        return current_status(&app);
    }
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return current_status(&app);
    }

    let initial = EmbeddingModelStatus {
        installed: false,
        downloading: true,
        progress: 0,
        downloaded_bytes: 0,
        total_bytes: None,
        model_id: MODEL_ID.to_string(),
        error: None,
    };
    emit_status(&app, initial.clone());

    std::thread::Builder::new()
        .name("embedding-model-download".into())
        .spawn(move || {
            let result = download_all(&app, &dir);
            DOWNLOADING.store(false, Ordering::SeqCst);
            match result {
                Ok(()) => {
                    let done = EmbeddingModelStatus {
                        installed: true,
                        downloading: false,
                        progress: 100,
                        downloaded_bytes: directory_size(&dir),
                        total_bytes: Some(directory_size(&dir)),
                        model_id: MODEL_ID.to_string(),
                        error: None,
                    };
                    emit_status(&app, done);
                    super::worker::notify_model_available(dir);
                }
                Err(error) => {
                    let failed = EmbeddingModelStatus {
                        installed: false,
                        downloading: false,
                        progress: 0,
                        downloaded_bytes: 0,
                        total_bytes: None,
                        model_id: MODEL_ID.to_string(),
                        error: Some(error),
                    };
                    emit_status(&app, failed);
                }
            }
        })
        .map_err(|e| {
            DOWNLOADING.store(false, Ordering::SeqCst);
            format!("Cannot start model download: {e}")
        })?;

    Ok(initial)
}

fn download_all(app: &AppHandle, dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create model directory: {e}"))?;
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| format!("Cannot create download client: {e}"))?;

    let mut downloaded_total = 0u64;
    let known_total: u64 = MODEL_FILES
        .iter()
        .filter_map(|name| {
            let local = dir.join(name);
            if model_file_is_valid(dir, name) {
                return local.metadata().ok().map(|m| m.len());
            }
            client
                .head(format!("{MODEL_BASE_URL}/{name}"))
                .send()
                .ok()
                .and_then(|r| r.error_for_status().ok())
                .and_then(|r| r.content_length())
        })
        .sum();

    for name in MODEL_FILES {
        let destination = dir.join(name);
        if model_file_is_valid(dir, name) {
            let size = destination.metadata().map(|m| m.len()).unwrap_or(0);
            downloaded_total += size;
            continue;
        }
        if destination.exists() {
            fs::remove_file(&destination)
                .map_err(|e| format!("Cannot replace invalid {name}: {e}"))?;
        }

        let url = format!("{MODEL_BASE_URL}/{name}");
        let mut response = client
            .get(&url)
            .send()
            .map_err(|e| format!("Cannot download {name}: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Cannot download {name}: {e}"))?;
        let file_total = response.content_length();

        let part = dir.join(format!("{name}.part"));
        let mut output =
            fs::File::create(&part).map_err(|e| format!("Cannot create {name}: {e}"))?;
        let mut file_downloaded = 0u64;
        let mut buffer = vec![0u8; 256 * 1024];

        loop {
            let count = response
                .read(&mut buffer)
                .map_err(|e| format!("Cannot read {name} download: {e}"))?;
            if count == 0 {
                break;
            }
            output
                .write_all(&buffer[..count])
                .map_err(|e| format!("Cannot write {name}: {e}"))?;
            file_downloaded += count as u64;

            let total = if known_total > 0 {
                Some(known_total)
            } else {
                file_total.map(|size| downloaded_total + size)
            };
            let current = downloaded_total + file_downloaded;
            let progress = total
                .map(|size| ((current.saturating_mul(100) / size.max(1)).min(99)) as u32)
                .unwrap_or(0);
            emit_status(
                app,
                EmbeddingModelStatus {
                    installed: false,
                    downloading: true,
                    progress,
                    downloaded_bytes: current,
                    total_bytes: total,
                    model_id: MODEL_ID.to_string(),
                    error: None,
                },
            );
        }
        output
            .sync_all()
            .map_err(|e| format!("Cannot flush {name}: {e}"))?;
        if let Some(expected) = file_total {
            if file_downloaded != expected {
                let _ = fs::remove_file(&part);
                return Err(format!(
                    "Incomplete {name} download: received {file_downloaded} of {expected} bytes"
                ));
            }
        }
        fs::rename(&part, &destination).map_err(|e| format!("Cannot finalize {name}: {e}"))?;
        downloaded_total += file_downloaded;
    }

    if !model_is_installed(dir) {
        return Err("Model download is incomplete".into());
    }
    Ok(())
}

fn directory_size(dir: &Path) -> u64 {
    MODEL_FILES
        .iter()
        .filter_map(|name| dir.join(name).metadata().ok())
        .map(|m| m.len())
        .sum()
}
