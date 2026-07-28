use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const MAX_BODY_BYTES: usize = 2_000_000;
const DEFAULT_UA: &str = "Mozilla/5.0 (compatible; MarkSpace/1.0; +https://markspace.app)";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
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

#[tauri::command]
pub fn http_fetch(req: HttpFetchRequest) -> Result<HttpFetchResponse, String> {
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
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let mut builder = if method == "POST" {
        client.post(parsed)
    } else {
        client.get(parsed)
    };
    builder = builder.headers(headers);
    if let Some(body) = &req.body {
        builder = builder.body(body.clone());
    }

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
