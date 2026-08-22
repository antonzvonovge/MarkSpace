use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const MAX_BODY_BYTES: usize = 2_000_000;
const MAX_BINARY_BYTES: usize = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const DEFAULT_UA: &str = "Mozilla/5.0 (compatible; MarkSpace/1.0; +https://markspace.app)";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    /// Raw POST body (base64). Takes precedence over `body` when set.
    #[serde(default)]
    pub body_base64: Option<String>,
    /// Optional request timeout in seconds (clamped 1..=120). Default 30.
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpMultipartRequest {
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub fields: Option<HashMap<String, String>>,
    pub file_field: String,
    pub file_name: String,
    pub file_base64: String,
    pub file_mime: Option<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

fn default_method() -> String {
    "GET".into()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchBytesResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub data_base64: String,
    pub byte_length: usize,
}

fn resolve_timeout(timeout_secs: Option<u64>) -> Duration {
    Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(1, 120))
}

fn build_client_request(
    req: &HttpFetchRequest,
) -> Result<reqwest::blocking::RequestBuilder, String> {
    let url = req.url.trim();
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http(s) URLs are allowed".into());
    }

    let method = req.method.trim().to_uppercase();
    if method != "GET" && method != "POST" {
        return Err("Only GET and POST are allowed".into());
    }

    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_UA));
    if let Some(map) = &req.headers {
        for (k, v) in map {
            let name = HeaderName::from_bytes(k.as_bytes())
                .map_err(|e| format!("Invalid header name '{k}': {e}"))?;
            let value = HeaderValue::from_str(v)
                .map_err(|e| format!("Invalid header value for '{k}': {e}"))?;
            headers.insert(name, value);
        }
    }

    let client = Client::builder()
        .timeout(resolve_timeout(req.timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let mut builder = if method == "POST" {
        client.post(parsed)
    } else {
        client.get(parsed)
    };
    builder = builder.headers(headers);
    if let Some(b64) = &req.body_base64 {
        let bytes = STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("Invalid bodyBase64: {e}"))?;
        builder = builder.body(bytes);
    } else if let Some(body) = &req.body {
        builder = builder.body(body.clone());
    }
    Ok(builder)
}

fn http_post_multipart_inner(
    req: HttpMultipartRequest,
) -> Result<HttpFetchResponse, String> {
    let url = req.url.trim();
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http(s) URLs are allowed".into());
    }

    let bytes = STANDARD
        .decode(req.file_base64.trim())
        .map_err(|e| format!("Invalid fileBase64: {e}"))?;
    if bytes.len() > MAX_BINARY_BYTES {
        return Err(format!(
            "Upload too large ({} bytes, max {MAX_BINARY_BYTES})",
            bytes.len()
        ));
    }

    let mut part = reqwest::blocking::multipart::Part::bytes(bytes).file_name(req.file_name.clone());
    if let Some(mime) = req.file_mime.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        part = part
            .mime_str(mime)
            .map_err(|e| format!("Invalid file mime: {e}"))?;
    }

    let mut form = reqwest::blocking::multipart::Form::new().part(req.file_field.clone(), part);
    if let Some(fields) = &req.fields {
        for (k, v) in fields {
            form = form.text(k.clone(), v.clone());
        }
    }

    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_UA));
    if let Some(map) = &req.headers {
        for (k, v) in map {
            let name = HeaderName::from_bytes(k.as_bytes())
                .map_err(|e| format!("Invalid header name '{k}': {e}"))?;
            let value = HeaderValue::from_str(v)
                .map_err(|e| format!("Invalid header value for '{k}': {e}"))?;
            headers.insert(name, value);
        }
    }

    let client = Client::builder()
        .timeout(resolve_timeout(req.timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let res = client
        .post(parsed)
        .headers(headers)
        .multipart(form)
        .send()
        .map_err(|e| format!("Request failed: {e}"))?;
    let status = res.status().as_u16();
    let bytes = res
        .bytes()
        .map_err(|e| format!("Failed to read response: {e}"))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err(format!(
            "Response too large ({} bytes, max {MAX_BODY_BYTES})",
            bytes.len()
        ));
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();
    Ok(HttpFetchResponse { status, body })
}

fn http_fetch_inner(req: HttpFetchRequest) -> Result<HttpFetchResponse, String> {
    let builder = build_client_request(&req)?;
    let res = builder
        .send()
        .map_err(|e| format!("Request failed: {e}"))?;
    let status = res.status().as_u16();
    let bytes = res
        .bytes()
        .map_err(|e| format!("Failed to read response: {e}"))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err(format!(
            "Response too large ({} bytes, max {MAX_BODY_BYTES})",
            bytes.len()
        ));
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();
    Ok(HttpFetchResponse { status, body })
}

fn http_fetch_bytes_inner(req: HttpFetchRequest) -> Result<HttpFetchBytesResponse, String> {
    let builder = build_client_request(&req)?;
    let res = builder
        .send()
        .map_err(|e| format!("Request failed: {e}"))?;
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string())
        .filter(|s| !s.is_empty());
    let bytes = res
        .bytes()
        .map_err(|e| format!("Failed to read response: {e}"))?;
    if bytes.len() > MAX_BINARY_BYTES {
        return Err(format!(
            "Response too large ({} bytes, max {MAX_BINARY_BYTES})",
            bytes.len()
        ));
    }
    Ok(HttpFetchBytesResponse {
        status,
        content_type,
        data_base64: STANDARD.encode(&bytes),
        byte_length: bytes.len(),
    })
}

/// Blocking reqwest must not run on the async runtime — it creates its own Tokio
/// runtime and panics on drop ("Cannot drop a runtime…"). Always use spawn_blocking.
#[tauri::command]
pub async fn http_fetch(req: HttpFetchRequest) -> Result<HttpFetchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || http_fetch_inner(req))
        .await
        .map_err(|e| format!("HTTP fetch task failed: {e}"))?
}

/// Fetch raw bytes (images/binaries) as base64. Larger limit than text `http_fetch`.
#[tauri::command]
pub async fn http_fetch_bytes(req: HttpFetchRequest) -> Result<HttpFetchBytesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || http_fetch_bytes_inner(req))
        .await
        .map_err(|e| format!("HTTP fetch task failed: {e}"))?
}

#[tauri::command]
pub async fn http_post_multipart(req: HttpMultipartRequest) -> Result<HttpFetchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || http_post_multipart_inner(req))
        .await
        .map_err(|e| format!("HTTP fetch task failed: {e}"))?
}
