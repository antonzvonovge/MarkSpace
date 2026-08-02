//! Split markdown into embeddable chunks by headings, with size fallback.

const TARGET_CHARS: usize = 1200;
const MAX_CHARS: usize = 1800;
const OVERLAP_CHARS: usize = 200;

#[derive(Debug, Clone)]
pub struct TextChunk {
    pub heading: Option<String>,
    pub text: String,
    pub start_line: u32,
    pub snippet: String,
}

pub fn chunk_markdown(content: &str) -> Vec<TextChunk> {
    let content = content.replace("\r\n", "\n").replace('\r', "\n");
    if content.trim().is_empty() {
        return Vec::new();
    }

    let mut sections: Vec<(Option<String>, u32, String)> = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut current_start: u32 = 1;
    let mut current_body = String::new();
    let mut line_no: u32 = 0;

    for line in content.lines() {
        line_no += 1;
        let heading = parse_heading(line);
        if let Some(h) = heading {
            if !current_body.trim().is_empty() || current_heading.is_some() {
                sections.push((
                    current_heading.clone(),
                    current_start,
                    std::mem::take(&mut current_body),
                ));
            }
            current_heading = Some(h);
            current_start = line_no;
            current_body.clear();
            continue;
        }
        if current_body.is_empty() && current_heading.is_none() {
            current_start = line_no;
        }
        current_body.push_str(line);
        current_body.push('\n');
    }
    if !current_body.trim().is_empty() || current_heading.is_some() {
        sections.push((current_heading, current_start, current_body));
    }

    if sections.is_empty() {
        return split_oversized(None, 1, &content);
    }

    let mut out = Vec::new();
    for (heading, start, body) in sections {
        let combined = match &heading {
            Some(h) => format!("{h}\n\n{}", body.trim()),
            None => body.trim().to_string(),
        };
        if combined.is_empty() {
            continue;
        }
        if combined.chars().count() <= MAX_CHARS {
            out.push(make_chunk(heading, start, &combined));
        } else {
            out.extend(split_oversized(heading, start, &combined));
        }
    }
    out
}

/// Chunk PDF page texts. `start_line` is the 1-based page number.
pub fn chunk_pdf(pages: &[String]) -> Vec<TextChunk> {
    let mut out = Vec::new();
    for (idx, page) in pages.iter().enumerate() {
        let text = page.trim();
        if text.is_empty() {
            continue;
        }
        let page_no = (idx + 1) as u32;
        let heading = Some(format!("Page {page_no}"));
        if text.chars().count() <= MAX_CHARS {
            out.push(make_chunk(heading, page_no, text));
        } else {
            out.extend(split_oversized(heading, page_no, text));
        }
    }
    out
}

fn parse_heading(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if !trimmed.starts_with('#') {
        return None;
    }
    let level = trimmed.chars().take_while(|c| *c == '#').count();
    if level == 0 || level > 3 {
        return None;
    }
    let rest = trimmed[level..].trim();
    if rest.is_empty() {
        return None;
    }
    // Require space after hashes for ATX headings.
    if trimmed.as_bytes().get(level) != Some(&b' ') && trimmed.as_bytes().get(level) != Some(&b'\t')
    {
        // "#Heading" without space — still accept common markdown.
        if !trimmed[level..].starts_with(|c: char| !c.is_whitespace()) {
            return None;
        }
    }
    Some(rest.to_string())
}

fn split_oversized(heading: Option<String>, start_line: u32, text: &str) -> Vec<TextChunk> {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut offset = 0usize;
    while offset < chars.len() {
        let end = (offset + TARGET_CHARS).min(chars.len());
        let mut take = end;
        if end < chars.len() {
            // Prefer break on paragraph/newline near the end.
            let window_start = offset + TARGET_CHARS.saturating_sub(200);
            if let Some(rel) = chars[window_start..end]
                .iter()
                .rposition(|c| *c == '\n')
            {
                take = window_start + rel + 1;
            }
        }
        if take <= offset {
            take = (offset + TARGET_CHARS).min(chars.len());
        }
        let piece: String = chars[offset..take].iter().collect();
        let piece = piece.trim();
        if !piece.is_empty() {
            let labeled = match &heading {
                Some(h) if offset > 0 => format!("{h}\n\n{piece}"),
                _ => piece.to_string(),
            };
            out.push(make_chunk(heading.clone(), start_line, &labeled));
        }
        if take >= chars.len() {
            break;
        }
        offset = take.saturating_sub(OVERLAP_CHARS);
        if offset >= take {
            offset = take;
        }
    }
    out
}

fn make_chunk(heading: Option<String>, start_line: u32, text: &str) -> TextChunk {
    let snippet: String = text.chars().take(220).collect();
    TextChunk {
        heading,
        text: text.to_string(),
        start_line,
        snippet,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_by_heading() {
        let md = "# A\n\nhello\n\n## B\n\nworld\n";
        let chunks = chunk_markdown(md);
        assert!(chunks.len() >= 2);
        assert_eq!(chunks[0].heading.as_deref(), Some("A"));
    }

    #[test]
    fn chunks_pdf_by_page() {
        let pages = vec!["alpha".into(), "".into(), "beta gamma".into()];
        let chunks = chunk_pdf(&pages);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].heading.as_deref(), Some("Page 1"));
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[1].heading.as_deref(), Some("Page 3"));
        assert_eq!(chunks[1].start_line, 3);
    }
}
