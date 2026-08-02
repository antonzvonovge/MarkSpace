# MarkSpace Markdown format

MarkSpace notes are Markdown with a small set of vault-specific extensions.
On disk the source is plain text; the live editor (BlockNote) round-trips through
these conventions. Agents that create or edit `.md` files **must** follow this
guide. Call `read_format_guide` for the full text when unsure.

<!-- core-rules:start -->
- Prefer wiki-links for notes: `[[Note]]` or `[[folder/note|Alias]]`. Do not use `[[Note#heading]]` (unsupported).
- In **chat replies**, reference vault notes with `[[vault/path/Note.md]]`, `[[Note|Label]]`, or `![[vault/path/Note.md]]` — all render as a clickable file link that opens the note. Mention a note this way whenever you create, open, or cite one.
- Embed Draw.io only as `![[path/diagram.drawio]]` or `![[path/diagram.drawio|480]]`. Outside the chat-only `.md` reference above, do not use `![[OtherNote]]` for notes.
- Images: `![alt](.assets/file.ext)` or Obsidian-style width `![alt|320](.assets/file.ext)`. Put one blank line before and after the image. Never invent `.assets/` paths — use `save_attachment` / `write_asset` / `read_file` (with `save_as`) / `clip_article` first.
- Tables: use GFM pipe tables. Colored cells become HTML `<table>` with `data-background-color` / `data-text-color` on cells; preserve that HTML when editing.
- Spacing: exactly one blank line between paragraphs and between a paragraph and a list/heading/code block. No multiple consecutive blank lines.
- Diagrams in notes: fenced ` ```mermaid ` or ` ```plantuml ` / ` ```puml `. Chat replies may use the same fences (rendered inline).
- Page metadata lives in YAML front-matter at the very top. MarkSpace manages `created` and `updated` ISO timestamps on save plus `tags:`, written as a block list of plain strings (`  - work`) — never `  - name: work` or any other mapping; keep any other keys intact and never duplicate the block.
- Inline tags in the body: `#multi-agent`, `#project/markspace` (letters, digits, `_`, `-`, `/`). Not ATX headings (`# Title`), not inside code/fences/URLs. Inline tags do **not** auto-write front-matter; both feed the vault tag catalog.
- Do **not** emit unsupported syntax (callouts, math, `==highlight==`, `%%comments%%`, footnotes, block ids, note embeds in note bodies). Full list: call `read_format_guide`.
<!-- core-rules:end -->

## Front-matter, timestamps, and page tags

Notes may start with a YAML front-matter block. It stores lifecycle timestamps and **page tags**, which are edited from the tag overlay in the top-right corner of the page (Live and Source).

```md
---
created: 2026-08-01T10:03:00.000Z
updated: 2026-08-01T10:15:42.000Z
tags:
  - work
  - inbox
  - project/markspace
---

# Note title
```

- The block must be the very first thing in the file: `---` on line 1, `---` closing line, then the body.
- `created` is set when MarkSpace creates the note (or on the first MarkSpace save of an existing note) and is then preserved. `updated` is refreshed on every save. Both use UTC ISO 8601 timestamps.
- The UI always writes tags as a block list of plain strings; `tags: [work, inbox]` and `tags: work` are also read correctly.
- Each item must be a scalar. Mapping items (`  - name: work`) are a mistake: they are tolerated on read (the `name` / `tag` value is used) but rewritten as plain strings on the next tag edit.
- Tag names: no leading `#`, trimmed, case preserved, deduplicated case-insensitively. Nesting is just a `/` inside the name (`area/topic`).
- Other keys (e.g. `aliases`) are preserved when tags change; when the last key is removed the whole block is dropped.
- Front-matter tags are edited from the tag overlay; the live editor loads only the markdown after the closing `---` and reattaches front-matter on save.
- You may also use **inline tags** in the body (below); they are separate from front-matter and are not copied into `tags:` automatically.

## Inline tags

In the note body, hashtags are styled inline tags (editable text in Live mode):

| On disk | Meaning |
|---|---|
| `#multi-agent` | Inline tag `multi-agent` |
| `#project/markspace` | Nested-style name (`/` inside the tag) |

- Valid name after `#`: Unicode letters/digits, then letters/digits/`_`/`-`/`/`.
- Must be bounded (start of text or after whitespace/punctuation). `word#tag` is not a tag.
- Not tags: ATX headings (`# Title`, `## H2`), content inside inline/fenced code, URL fragments (`https://ex.com/a#frag`), wiki targets (`[[Note#heading]]` remains unsupported).
- Trailing punctuation (`.`, `,`, `!`, `)`) stays outside the tag: `#work.` → tag `work` + `.`.
- Inline tags remain ordinary markdown text — you can place the caret inside and edit them. Live mode only highlights matching `#tags`.
- Inline tags and front-matter `tags` share one vault catalog for suggestions; writing `#work` does **not** add `work` to YAML front-matter.

## Links

| On disk | Meaning |
|---|---|
| `[[Welcome]]` | Wiki-link to note by path/name (opens or creates) |
| `[[projects/ideas\|Ideas]]` | Wiki-link with display alias |
| `[Site](https://example.com)` | External URL (system browser) |
| `[Local](./Welcome.md)` | Relative file link when possible |

Wiki targets must not contain `#` or `|` inside the target segment. Heading anchors like `[[Note#Section]]` are **not** supported.

Internally the editor may temporarily rewrite wiki-links to `[text](wiki:…)` and back; on disk always prefer `[[…]]`.

### Note references in chat replies

Chat replies render wiki-links as clickable note references — a file icon plus
link text. Clicking opens the note or activates its existing editor tab.

| In a chat reply | Result |
|---|---|
| `[[vault/path/Note.md]]` | Link labelled with the path |
| `[[vault/path/Note]]` | Same; the target is resolved without the extension |
| `[[vault/path/Note\|Display label]]` | Link labelled `Display label` |
| `![[vault/path/Note.md]]` | Same as the plain `[[…]]` form (not an embed) |

Use this whenever you create, open, or cite a note, so the user can jump to it.
Targets are vault-relative and must not contain `#` or `|` in the path segment.

## Embeds (Draw.io only)

| On disk | Meaning |
|---|---|
| `![[diagram.drawio]]` | Embed a `.drawio` file (default preview width 480) |
| `![[folder/diagram.drawio\|480]]` | Embed with explicit preview width (pixels) |

Only paths ending in `.drawio` are embeds. General note embeds `![[SomeNote]]` are **not** supported.

Legacy HTML `<div data-drawio-src="…">` may still round-trip to `![[…]]`; prefer the wiki embed form when writing new content.

## Images and assets

- Relative images often live under a sibling `.assets/` folder next to the note (or as returned by `save_attachment` / `write_asset`).
- You may also save with `read_file` + `save_as` to any vault-relative path the user requests; use the returned `saved_path` in markdown (relative to the note when possible).
- Plain: `![alt text](.assets/photo.png)`
- Width (Obsidian-style): `![alt|320](.assets/photo.png)` or `![320](.assets/photo.png)`
- `![alt|320x200](…)` — only the width is kept; height is ignored
- Captioned images may persist as HTML `<figure><img width="…">…</figure>`; preserve width when editing
- Always one blank line before and after an image block

## Tables

- Uncolored tables: GFM pipe tables

```md
| A | B |
|---|---|
| 1 | 2 |
```

- When any cell has a non-default background or text color, the note stores a full HTML `<table>` with `data-background-color` and/or `data-text-color` on cells. Do not convert those back to GFM pipes or you will lose colors.

## Diagrams

Fenced code blocks in notes (and in chat replies):

````md
```mermaid
flowchart TD
  A --> B
```

```plantuml
@startuml
A -> B
@enduml
```
````

Language tags: `mermaid`, `plantuml`, or `puml`. Prefer these for sketches in chat; use Draw.io tools only for `.drawio` vault files.

## Standard blocks

Supported via the editor (typical on-disk forms):

| Feature | Syntax |
|---|---|
| Headings | `#` … `######` |
| Paragraphs | blank-line separated |
| Bold / italic / strike / inline code | `**` `*` `~~` `` ` `` |
| Blockquote | `> …` |
| Bullet / numbered lists | `- ` / `1. ` |
| Task lists | `- [ ]` / `- [x]` |
| Toggle lists | HTML `<details>` / `<summary>` (structure may flatten on export) |
| Code blocks | `` ```lang `` |
| Divider | `---` |
| Images / links / tables | as above |

Slash menu hides video/audio/file blocks; do not invent those block types in markdown.

## Round-trip caveats

- **Underline and text/background colors** applied in the live UI are stripped on Markdown export — they are not a durable on-disk format (except table cell colors via HTML tables).
- **CRLF** is normalized to LF on load; trailing `\` hard-breaks inside fenced code that came from CRLF corruption are healed. Prefer LF and do not add stray `\` at ends of fence lines.
- Wiki-links and Draw.io embeds are rewritten through intermediate forms in the editor; always write the on-disk forms documented here when using `edit_note` / `write_note`.

## Not supported

Do **not** generate any of the following — the editor will treat them as plain text or corrupt the note:

- TOML front-matter (`+++` blocks) — only YAML `---` front-matter is read, and only `tags` is managed
- Callouts / admonitions (`> [!note]`, `::: tip`, etc.)
- Math (`$…$`, `$$…$$`, KaTeX/MathJax)
- `==highlight==` syntax
- Comments (`%%…%%`)
- Footnotes (`[^1]`)
- Block IDs (`^block-id`)
- Wiki heading anchors (`[[Note#heading]]`)
- Note embeds in note bodies (`![[OtherNote]]` — only `.drawio` embeds work). Chat replies may use `![[path/Note.md]]` as a clickable note reference (see above); that is not an embed.
- MDX / custom directives
