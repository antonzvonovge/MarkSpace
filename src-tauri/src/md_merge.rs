//! Semantic 3-way merge for Markdown notes with YAML frontmatter.
//!
//! Plain git union merge keeps unique lines but does not understand frontmatter,
//! which produces broken diary notes (duplicate `---`, headers, and timestamps).

use serde_yaml::{Mapping, Value};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SplitMarkdown {
    pub has_fence: bool,
    /// Parsed YAML mapping, or `None` when there is no fence or YAML failed.
    pub data: Option<Mapping>,
    pub body: String,
}

/// Split a note into optional YAML frontmatter and markdown body.
pub fn split_markdown(text: &str) -> SplitMarkdown {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let after_open = if text.starts_with("---\r\n") {
        5
    } else if text.starts_with("---\n") {
        4
    } else {
        return SplitMarkdown {
            has_fence: false,
            data: None,
            body: text.to_string(),
        };
    };

    let rest = &text[after_open..];
    let close = match rest.find("\n---") {
        Some(i) => i,
        None => {
            return SplitMarkdown {
                has_fence: false,
                data: None,
                body: text.to_string(),
            };
        }
    };

    let yaml_text = rest[..close].trim_end_matches('\r');
    let after_close = close + 4; // \n---
    let body = rest.get(after_close..).unwrap_or("").to_string();
    let body = body
        .strip_prefix("\r\n")
        .or_else(|| body.strip_prefix('\n'))
        .unwrap_or(body.as_str())
        .to_string();

    let data = match serde_yaml::from_str::<Value>(yaml_text) {
        Ok(Value::Mapping(map)) if !map.is_empty() => Some(map),
        Ok(_) => Some(Mapping::new()),
        Err(_) => None,
    };

    SplitMarkdown {
        has_fence: true,
        data,
        body,
    }
}

/// Merge two note versions. Returns `None` when frontmatter is unparseable on either fenced side.
pub fn merge_markdown_notes(ours: &str, theirs: &str, base: Option<&str>) -> Option<String> {
    let ours_split = split_markdown(ours);
    let theirs_split = split_markdown(theirs);
    let base_split = base.map(split_markdown);

    if ours_split.has_fence && ours_split.data.is_none() {
        return None;
    }
    if theirs_split.has_fence && theirs_split.data.is_none() {
        return None;
    }

    let merged_data = merge_frontmatter_maps(
        ours_split.data.as_ref(),
        theirs_split.data.as_ref(),
        base_split.as_ref().and_then(|s| s.data.as_ref()),
    );
    let merged_body = merge_bodies(&ours_split.body, &theirs_split.body);
    Some(serialize_markdown(merged_data.as_ref(), &merged_body))
}

fn merge_frontmatter_maps(
    ours: Option<&Mapping>,
    theirs: Option<&Mapping>,
    base: Option<&Mapping>,
) -> Option<Mapping> {
    let ours = ours.cloned().unwrap_or_default();
    let theirs = theirs.cloned().unwrap_or_default();
    let base = base.cloned().unwrap_or_default();

    if ours.is_empty() && theirs.is_empty() && base.is_empty() {
        return None;
    }

    let mut keys: HashSet<String> = HashSet::new();
    for map in [&base, &ours, &theirs] {
        for key in map.keys() {
            if let Some(k) = key.as_str() {
                keys.insert(k.to_string());
            }
        }
    }

    let mut out = Mapping::new();
    for key in keys {
        let b = base.get(&key);
        let o = ours.get(&key);
        let t = theirs.get(&key);
        let merged = match key.as_str() {
            "tags" => merge_tags(o.or(b), t.or(b)),
            "created" => earliest_timestamp(o.or(b), t.or(b)),
            "updated" => latest_timestamp(o.or(b), t.or(b)),
            _ => merge_generic_field(b, o, t),
        };
        if let Some(value) = merged {
            out.insert(Value::String(key), value);
        }
    }

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn merge_tags(ours: Option<&Value>, theirs: Option<&Value>) -> Option<Value> {
    let mut seen = HashSet::new();
    let mut tags: Vec<Value> = Vec::new();
    for value in [ours, theirs] {
        for tag in value_to_tag_list(value) {
            let key = tag.to_ascii_lowercase();
            if seen.insert(key) {
                tags.push(Value::String(tag));
            }
        }
    }
    if tags.is_empty() {
        None
    } else {
        Some(Value::Sequence(tags))
    }
}

fn value_to_tag_list(value: Option<&Value>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    match value {
        Value::Sequence(items) => items
            .iter()
            .filter_map(|item| tag_scalar(item))
            .collect(),
        Value::String(s) => s
            .split(',')
            .filter_map(|part| tag_scalar(&Value::String(part.trim().to_string())))
            .collect(),
        _ => tag_scalar(value).into_iter().collect(),
    }
}

fn tag_scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => normalize_tag_name(s),
        Value::Number(n) => normalize_tag_name(&n.to_string()),
        Value::Mapping(map) => map
            .get(Value::String("name".into()))
            .or_else(|| map.get(Value::String("tag".into())))
            .and_then(tag_scalar),
        _ => None,
    }
}

fn normalize_tag_name(raw: &str) -> Option<String> {
    let mut t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(rest) = t.strip_prefix('#') {
        t = rest.trim();
    }
    if t.is_empty() || t.chars().all(|c| c.is_numeric()) {
        return None;
    }
    Some(t.to_string())
}

fn earliest_timestamp(ours: Option<&Value>, theirs: Option<&Value>) -> Option<Value> {
    pick_timestamp(ours, theirs, true)
}

fn latest_timestamp(ours: Option<&Value>, theirs: Option<&Value>) -> Option<Value> {
    pick_timestamp(ours, theirs, false)
}

fn pick_timestamp(ours: Option<&Value>, theirs: Option<&Value>, earliest: bool) -> Option<Value> {
    let mut best: Option<(String, Value)> = None;
    for value in [ours, theirs] {
        let Some(value) = value else { continue };
        let Some(raw) = value.as_str() else { continue };
        let candidate = Value::String(raw.to_string());
        best = Some(match best {
            None => (raw.to_string(), candidate),
            Some((prev_raw, prev_val)) => {
                let pick_candidate = if earliest {
                    raw <= prev_raw.as_str()
                } else {
                    raw >= prev_raw.as_str()
                };
                if pick_candidate {
                    (raw.to_string(), candidate)
                } else {
                    (prev_raw, prev_val)
                }
            }
        });
    }
    best.map(|(_, v)| v)
}

fn merge_generic_field(base: Option<&Value>, ours: Option<&Value>, theirs: Option<&Value>) -> Option<Value> {
    if ours == theirs {
        return ours.cloned();
    }
    if ours == base {
        return theirs.cloned();
    }
    if theirs == base {
        return ours.cloned();
    }
    ours.cloned().or_else(|| theirs.cloned())
}

fn merge_bodies(ours: &str, theirs: &str) -> String {
    let ours = clean_body(ours);
    let theirs = clean_body(theirs);
    if ours.trim().is_empty() {
        return theirs;
    }
    if theirs.trim().is_empty() {
        return ours;
    }

    let (ours_h1, ours_rest) = peel_leading_h1(&ours);
    let (theirs_h1, theirs_rest) = peel_leading_h1(&theirs);
    let heading = ours_h1.or(theirs_h1);
    let heading_key = heading.as_ref().map(|h| normalize_heading(h));

    let mut seen = HashSet::new();
    let mut blocks: Vec<String> = Vec::new();

    for block in blocks_from_body(&ours_rest)
        .into_iter()
        .chain(blocks_from_body(&theirs_rest))
    {
        let block = strip_duplicate_heading(&block, heading_key.as_deref());
        let key = normalize_block_key(&block);
        if key.is_empty() {
            continue;
        }
        if seen.insert(key) {
            blocks.push(block);
        }
    }

    let mut parts: Vec<String> = Vec::new();
    if let Some(h1) = heading {
        parts.push(h1);
    }
    parts.extend(blocks);
    if parts.is_empty() {
        return String::new();
    }
    let mut out = parts.join("\n\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn peel_leading_h1(body: &str) -> (Option<String>, String) {
    let trimmed = body.trim_start();
    let Some(rest) = trimmed.strip_prefix('#') else {
        return (None, body.to_string());
    };
    let after_hash = rest.trim_start();
    let (heading_line, remainder) = match after_hash.find('\n') {
        Some(i) => (&after_hash[..i], after_hash[i + 1..].trim_start()),
        None => (after_hash, ""),
    };
    if heading_line.trim().is_empty() {
        return (None, body.to_string());
    }
    (
        Some(format!("# {}", heading_line.trim())),
        remainder.to_string(),
    )
}

fn normalize_heading(h1: &str) -> String {
    h1.trim_start_matches('#').trim().to_ascii_lowercase()
}

fn strip_duplicate_heading(block: &str, heading_key: Option<&str>) -> String {
    let Some(heading_key) = heading_key else {
        return block.to_string();
    };
    let trimmed = block.trim_start();
    let Some(rest) = trimmed.strip_prefix('#') else {
        return block.to_string();
    };
    let line = rest.trim_start().lines().next().unwrap_or("").trim();
    if line.to_ascii_lowercase() == heading_key {
        let after = rest.trim_start();
        let after_line = after.find('\n').map(|i| after[i + 1..].trim_start()).unwrap_or("");
        return after_line.to_string();
    }
    block.to_string()
}

fn clean_body(body: &str) -> String {
    let mut lines: Vec<&str> = Vec::new();
    for line in body.lines() {
        if is_stray_frontmatter_line(line) {
            continue;
        }
        lines.push(line);
    }
    lines.join("\n")
}

fn is_stray_frontmatter_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed == "---"
        || trimmed.starts_with("created:")
        || trimmed.starts_with("updated:")
        || trimmed.starts_with("tags:")
}

fn blocks_from_body(body: &str) -> Vec<String> {
    let mut blocks: Vec<String> = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for line in body.lines() {
        if line.trim().is_empty() {
            if !current.is_empty() {
                blocks.push(current.join("\n"));
                current.clear();
            }
            continue;
        }
        current.push(line);
    }
    if !current.is_empty() {
        blocks.push(current.join("\n"));
    }
    blocks
}

fn normalize_block_key(block: &str) -> String {
    let trimmed = block.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(rest) = trimmed.strip_prefix('#') {
        let heading = rest.trim();
        if !heading.is_empty() && !trimmed.contains('\n') {
            return format!("h1:{}", heading.to_ascii_lowercase());
        }
    }
    trimmed
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .to_ascii_lowercase()
}

fn serialize_markdown(data: Option<&Mapping>, body: &str) -> String {
    let body = body.trim_start_matches('\n');
    let Some(data) = data else {
        return body.to_string();
    };
    if data.is_empty() {
        return body.to_string();
    }
    let yaml = serde_yaml::to_string(data).unwrap_or_default();
    let yaml = yaml.trim_end();
    format!("---\n{yaml}\n---\n{body}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_diary_frontmatter_and_body() {
        let ours = "\
---
tags:
  - diary
created: 2026-09-02T03:45:29.220Z
updated: 2026-09-02T03:46:31.006Z
---
# 2 Сентября 2026

* Вчера я применил стиль
";
        let theirs = "\
---
tags:
  - diary
created: 2026-09-02T05:18:49.513Z
updated: 2026-09-02T05:18:49.513Z
---
# 2 Сентября 2026
2026-09-02 09:24
";
        let merged = merge_markdown_notes(ours, theirs, None).expect("merge");
        assert_eq!(merged.matches("---").count(), 2);
        assert_eq!(merged.matches("# 2 Сентября 2026").count(), 1);
        assert!(merged.contains("* Вчера я применил стиль"));
        assert!(merged.contains("2026-09-02 09:24"));
        assert!(merged.contains("created: 2026-09-02T03:45:29.220Z"));
        assert!(merged.contains("updated: 2026-09-02T05:18:49.513Z"));
        assert!(!merged.contains("created: 2026-09-02T05:18:49.513Z\nupdated:"));
    }

    #[test]
    fn merge_tags_unions_both_sides() {
        let ours = "---\ntags:\n  - diary\n  - work\n---\nBody\n";
        let theirs = "---\ntags:\n  - diary\n  - home\n---\nBody\n";
        let merged = merge_markdown_notes(ours, theirs, None).expect("merge");
        assert!(merged.contains("- diary"));
        assert!(merged.contains("- work"));
        assert!(merged.contains("- home"));
    }

    #[test]
    fn unparseable_frontmatter_returns_none() {
        let ours = "---\n: bad: [yaml\n---\nBody\n";
        let theirs = "---\ntags:\n  - diary\n---\nBody\n";
        assert!(merge_markdown_notes(ours, theirs, None).is_none());
    }

    #[test]
    fn strips_stray_frontmatter_lines_from_body() {
        let ours = "\
---
tags:
  - diary
---
# Title

Line one
";
        let theirs = "\
created: 2026-09-02T05:18:49.513Z
updated: 2026-09-02T05:18:49.513Z
---
# Title

Line two
";
        let merged = merge_markdown_notes(ours, theirs, None).expect("merge");
        assert!(!merged.contains("created: 2026-09-02T05:18:49"));
        assert!(merged.contains("Line one"));
        assert!(merged.contains("Line two"));
    }
}
