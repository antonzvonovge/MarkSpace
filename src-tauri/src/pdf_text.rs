//! Extract plain text from PDF files for search and embeddings.

use serde::Serialize;
use std::path::Path;
use tauri::State;

use crate::vault::{ensure_inside, get_root, VaultState};

/// Extract text per page. Empty pages become empty strings (index preserved).
pub fn extract_pdf_pages(bytes: &[u8]) -> Result<Vec<String>, String> {
    pdf_extract::extract_text_from_mem_by_pages(bytes)
        .map_err(|e| format!("Cannot extract PDF text: {e}"))
}

/// Join non-empty page texts with blank lines.
#[allow(dead_code)]
pub fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let pages = extract_pdf_pages(bytes)?;
    Ok(pages
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n"))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PdfTextResult {
    pub path: String,
    pub page_count: usize,
    pub text: String,
    pub pages: Vec<String>,
    pub truncated: bool,
}

const MAX_EXTRACT_CHARS: usize = 200_000;

#[tauri::command(async)]
pub fn extract_pdf_text_cmd(
    path: String,
    state: State<'_, VaultState>,
) -> Result<PdfTextResult, String> {
    let root = get_root(&state)?;
    let rel = path.trim().trim_start_matches('/');
    let full = ensure_inside(&root, Path::new(rel))?;
    if !full.is_file() {
        return Err(format!("File not found: {rel}"));
    }
    let name = full
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if !name.to_lowercase().ends_with(".pdf") {
        return Err("Not a PDF file".into());
    }
    let bytes = std::fs::read(&full).map_err(|e| format!("Cannot read PDF: {e}"))?;
    let pages = extract_pdf_pages(&bytes)?;
    let page_count = pages.len();
    let mut text = pages
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut truncated = false;
    if text.chars().count() > MAX_EXTRACT_CHARS {
        text = text.chars().take(MAX_EXTRACT_CHARS).collect();
        text.push_str("\n\n…[truncated]");
        truncated = true;
    }
    Ok(PdfTextResult {
        path: rel.to_string(),
        page_count,
        text,
        pages,
        truncated,
    })
}
