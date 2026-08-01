# MarkSpace links format (`.mdlnks`)

`.mdlnks` files are link collections — not Markdown. Agents must prefer dedicated links tools (`read_links`, `add_link`, `update_link`, `remove_link`, `reorder_links`, `set_links_filter`, `create_links`) over raw `edit_note` / `write_note`.

Call `read_mdlnks_format` for this full guide when unsure.

<!-- core-rules:start -->
- `.mdlnks` is a links document, not Markdown. Do not use GFM tables, wiki-links, or front-matter.
- Prefer links tools over raw `edit_note` / `write_note` on `.mdlnks` files.
- Line 1 must be exactly `# MarkSpace links v1`.
- Optional `filter: tag1, tag2` stores UI multi-tag filter (AND). Empty / omit = no filter.
- Link entries are separated by a blank line; file order is display order.
- Each entry starts with a URL line (`http://`, `https://`, `mailto:`, `file://`, or `ftp://`).
- Optional `description:` (single line) and `tags:` (comma-separated, no `#`).
- Do not put `|` pipe tables or blank lines inside an entry.
<!-- core-rules:end -->

## Example

```text
# MarkSpace links v1
filter: ai, reading

https://example.com
description: Short what this is
tags: ai, reading

https://other.com
description: Another
tags: work
```

## Header

- First line: `# MarkSpace links v1` (required).
- Next non-empty line may be `filter: …` (comma-separated tags). This is persisted UI filter state.

## Entries

- Separated by one or more blank lines.
- First line of an entry = URL (required).
- Optional metadata lines (order flexible within the entry):
  - `description: …` — single line
  - `tags: a, b` — comma-separated; no leading `#`
- Tags are case-preserved; duplicates in a list are ignored case-insensitively.

## Filter semantics

When `filter` lists one or more tags, the UI shows only items that include **all** of those tags (AND). Tools may update `filter` via `set_links_filter`.

## Editing rules for agents

1. Prefer structured tools that parse → mutate → serialize.
2. If you must write raw text, preserve the header, blank-line separation, and never convert the file to a Markdown table.
3. Do not invent titles — items have only url, description, and tags.
