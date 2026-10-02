//! Rewrite a tag and its `tag/…` descendants in note markdown and tag lists.
//!
//! Front-matter `tags:` and inline `#tags` are both updated. A child tag is not
//! treated as the parent tag unless the stored string actually has that prefix.

/// `tag` equals `branch`, or starts with `branch/`, ignoring case.
pub fn tag_matches_branch(tag: &str, branch: &str) -> bool {
    let tag = tag.to_lowercase();
    let branch = branch.to_lowercase();
    if tag.is_empty() || branch.is_empty() {
        return false;
    }
    tag == branch || tag.starts_with(&format!("{branch}/"))
}

/// Rename `from` and `from/…`. Other tags are unchanged.
pub fn remap_tag_prefix(tag: &str, from: &str, to: &str) -> String {
    let tag_l = tag.to_lowercase();
    let from_l = from.to_lowercase();
    if tag_l == from_l {
        return to.to_string();
    }
    if tag_l.starts_with(&format!("{from_l}/")) {
        let suffix: String = tag.chars().skip(from.chars().count()).collect();
        return format!("{to}{suffix}");
    }
    tag.to_string()
}

/// Drop the branch when `to` is `None`. Dedupes case-insensitively.
pub fn apply_tag_list(tags: &[String], from: &str, to: Option<&str>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for tag in tags {
        let name = tag.trim();
        if name.is_empty() {
            continue;
        }
        let next = if tag_matches_branch(name, from) {
            match to {
                None => continue,
                Some(dest) => remap_tag_prefix(name, from, dest),
            }
        } else {
            name.to_string()
        };
        let next = next.trim().to_string();
        if next.is_empty() {
            continue;
        }
        let key = next.to_lowercase();
        if seen.insert(key) {
            out.push(next);
        }
    }
    out
}

fn is_name_start(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn is_name_cont(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

fn is_boundary(prev: Option<char>) -> bool {
    match prev {
        None => true,
        Some(c) => !(c.is_alphanumeric() || c == '_' || c == '-' || c == '/'),
    }
}

fn unwrap_token(raw: &str) -> &str {
    let mut value = raw.trim();
    if let Some(inner) = value
        .strip_prefix('{')
        .and_then(|s| s.strip_suffix('}'))
    {
        value = inner.trim();
    }
    for key in ["name:", "tag:", "title:"] {
        if let Some(rest) = value.strip_prefix(key) {
            let rest = rest.trim();
            if !rest.is_empty() && !rest.contains(':') {
                return rest.trim_matches(['"', '\'']);
            }
        }
    }
    value.trim_matches(['"', '\''])
}

/// `None` deletes the tag. `Some` is the replacement, or the original token when unchanged.
fn map_token(raw: &str, from: &str, to: Option<&str>) -> Option<String> {
    let token = raw.trim();
    if token.is_empty() {
        return Some(token.to_string());
    }
    let name = unwrap_token(token);
    if name.is_empty() || name.chars().all(|c| c.is_numeric()) {
        return Some(token.to_string());
    }
    if !tag_matches_branch(name, from) {
        return Some(token.to_string());
    }
    match to {
        None => None,
        Some(dest) => Some(remap_tag_prefix(name, from, dest)),
    }
}

fn rewrite_yaml_tags(yaml: &str, from: &str, to: Option<&str>) -> String {
    let lines: Vec<&str> = yaml.split('\n').collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix("tags:") else {
            out.push(line.to_string());
            i += 1;
            continue;
        };
        let value = rest.trim();
        if value.is_empty() {
            let mut items: Vec<String> = Vec::new();
            let mut changed = false;
            i += 1;
            while i < lines.len() {
                let item_line = lines[i];
                let indented = item_line.starts_with(' ') || item_line.starts_with('\t');
                let item_trim = item_line.trim();
                if !indented {
                    break;
                }
                if let Some(raw) = item_trim.strip_prefix("- ") {
                    match map_token(raw, from, to) {
                        None => changed = true,
                        Some(next) if next == raw.trim() => items.push(item_line.to_string()),
                        Some(next) => {
                            changed = true;
                            items.push(format!("  - {next}"));
                        }
                    }
                } else {
                    items.push(item_line.to_string());
                }
                i += 1;
            }
            if !changed {
                out.push(line.to_string());
                out.extend(items);
            } else if !items.is_empty() {
                out.push("tags:".into());
                out.extend(items);
            }
            continue;
        }

        let rewritten = if let Some(inner) = value
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
        {
            let mut parts = Vec::new();
            let mut changed = false;
            for part in inner.split(',') {
                let part = part.trim();
                if part.is_empty() {
                    continue;
                }
                match map_token(part, from, to) {
                    None => changed = true,
                    Some(next) if next == part => parts.push(next),
                    Some(next) => {
                        changed = true;
                        parts.push(next);
                    }
                }
            }
            if !changed {
                Some(line.to_string())
            } else if parts.is_empty() {
                None
            } else {
                Some(format!("tags: [{}]", parts.join(", ")))
            }
        } else {
            let mut parts = Vec::new();
            let mut changed = false;
            for part in value.split(',') {
                let part = part.trim();
                if part.is_empty() {
                    continue;
                }
                match map_token(part, from, to) {
                    None => changed = true,
                    Some(next) if next == part => parts.push(next),
                    Some(next) => {
                        changed = true;
                        parts.push(next);
                    }
                }
            }
            if !changed {
                Some(line.to_string())
            } else if parts.is_empty() {
                None
            } else {
                Some(format!("tags: {}", parts.join(", ")))
            }
        };
        if let Some(next_line) = rewritten {
            out.push(next_line);
        }
        i += 1;
    }
    out.join("\n")
}

fn rewrite_hashtags(body: &str, from: &str, to: Option<&str>) -> String {
    let chars: Vec<char> = body.chars().collect();
    let n = chars.len();
    let mut out = String::new();
    let mut i = 0usize;
    let mut prev: Option<char> = None;
    let mut in_fence: Option<char> = None;
    let mut fence_len = 0usize;

    while i < n {
        let c = chars[i];

        if (c == '`' || c == '~') && (prev.is_none() || prev == Some('\n')) {
            let mut run = 1usize;
            while i + run < n && chars[i + run] == c {
                run += 1;
            }
            if run >= 3 {
                if let Some(fc) = in_fence {
                    if fc == c && run >= fence_len {
                        in_fence = None;
                        fence_len = 0;
                    }
                } else {
                    in_fence = Some(c);
                    fence_len = run;
                }
                while i < n && chars[i] != '\n' {
                    out.push(chars[i]);
                    i += 1;
                }
                if i < n {
                    out.push('\n');
                    i += 1;
                    prev = Some('\n');
                } else {
                    prev = Some(c);
                }
                continue;
            }
        }

        if in_fence.is_some() {
            out.push(c);
            prev = Some(c);
            i += 1;
            continue;
        }

        if c == '`' {
            let mut run = 1usize;
            while i + run < n && chars[i + run] == '`' {
                run += 1;
            }
            let mut j = i + run;
            let mut matched = false;
            while j + run <= n {
                if chars[j..j + run].iter().all(|ch| *ch == '`') {
                    for ch in &chars[i..j + run] {
                        out.push(*ch);
                    }
                    i = j + run;
                    prev = Some('`');
                    matched = true;
                    break;
                }
                j += 1;
            }
            if matched {
                continue;
            }
            out.push(c);
            prev = Some(c);
            i += 1;
            continue;
        }

        if c == '#' && is_boundary(prev) {
            let start = i + 1;
            if start < n && is_name_start(chars[start]) {
                let mut end = start + 1;
                while end < n && is_name_cont(chars[end]) {
                    end += 1;
                }
                let name: String = chars[start..end].iter().collect();
                if !name.chars().all(|ch| ch.is_numeric()) && tag_matches_branch(&name, from) {
                    if let Some(dest) = to {
                        out.push('#');
                        out.push_str(&remap_tag_prefix(&name, from, dest));
                    }
                    i = end;
                    prev = chars.get(end.wrapping_sub(1)).copied();
                    continue;
                }
            }
        }

        out.push(c);
        prev = Some(c);
        i += 1;
    }
    out
}

fn split_frontmatter(content: &str) -> Option<(&str, &str)> {
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let after_open = if text.starts_with("---\r\n") {
        5
    } else if text.starts_with("---\n") {
        4
    } else {
        return None;
    };
    let rest = &text[after_open..];
    if rest.starts_with("---") {
        let after = if rest.starts_with("---\r\n") {
            5
        } else if rest.starts_with("---\n") {
            4
        } else if rest == "---" {
            3
        } else {
            return None;
        };
        return Some(("", &rest[after..]));
    }
    let idx = rest.find("\n---")?;
    let yaml = rest[..idx].strip_suffix('\r').unwrap_or(&rest[..idx]);
    let mut body = &rest[idx + 1 + 3..];
    if let Some(stripped) = body.strip_prefix("\r\n") {
        body = stripped;
    } else if let Some(stripped) = body.strip_prefix('\n') {
        body = stripped;
    }
    Some((yaml, body))
}

/// Rewrite tags in a markdown note. `to == None` removes the branch.
pub fn rewrite_note_content(content: &str, from: &str, to: Option<&str>) -> String {
    let bom = if content.starts_with('\u{feff}') {
        "\u{feff}"
    } else {
        ""
    };
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let Some((yaml, body)) = split_frontmatter(text) else {
        return format!("{bom}{}", rewrite_hashtags(text, from, to));
    };
    let next_yaml = rewrite_yaml_tags(yaml, from, to);
    let next_body = rewrite_hashtags(body, from, to);
    if next_yaml.trim().is_empty() {
        return format!("{bom}{next_body}");
    }
    format!("{bom}---\n{next_yaml}\n---\n{next_body}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renames_yaml_and_inline_branch() {
        let src = "---\ntags:\n  - language\n  - language/georgian\n  - work\n---\nSee #language and #language/georgian.\n";
        let next = rewrite_note_content(src, "language", Some("tongues"));
        assert!(next.contains("  - tongues\n"));
        assert!(next.contains("  - tongues/georgian\n"));
        assert!(next.contains("  - work\n"));
        assert!(next.contains("#tongues "));
        assert!(next.contains("#tongues/georgian."));
        assert!(!next.contains("#language"));
    }

    #[test]
    fn delete_removes_branch_and_keeps_the_note() {
        let src = "---\ntags:\n  - language/georgian\n  - work\n---\n#language/georgian stays? no #work\n";
        let next = rewrite_note_content(src, "language", None);
        assert!(next.contains("  - work\n"));
        assert!(!next.to_lowercase().contains("language"));
        assert!(next.contains("#work"));
    }

    #[test]
    fn leaves_code_fences_alone() {
        let src = "```\n#language\n```\n#language\n";
        let next = rewrite_note_content(src, "language", Some("tongues"));
        assert!(next.contains("```\n#language\n```"));
        assert!(next.contains("\n#tongues\n"));
    }

    #[test]
    fn list_rename_merges_case() {
        let tags = vec!["Language".into(), "language/georgian".into(), "work".into()];
        assert_eq!(
            apply_tag_list(&tags, "language", Some("work")),
            vec!["work".to_string(), "work/georgian".to_string()]
        );
    }
}
