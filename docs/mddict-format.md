# MarkSpace dictionary format (`.mddict`)

`.mddict` files are vocabulary / dictionary collections — not Markdown. Agents must prefer dedicated dictionary tools (`read_dictionary`, `add_entry`, `update_entry`, `remove_entry`, `reorder_entries`, `set_dictionary_filter`, `create_dictionary`) over raw `edit_note` / `write_note`.

Call `read_mddict_format` for this full guide when unsure.

<!-- core-rules:start -->
- `.mddict` is a dictionary document, not Markdown. Do not use GFM tables, wiki-links, or front-matter.
- Prefer dictionary tools over raw `edit_note` / `write_note` on `.mddict` files.
- Line 1 must be exactly `# MarkSpace dictionary v1`.
- Optional `filter: tag1, tag2` stores UI multi-tag filter (AND). Empty / omit = no filter.
- Entries are separated by a blank line; file order is display order.
- Each entry starts with a word line (plain text, not a `key:` field).
- Optional metadata: `transcript:`, `translation:` (single line each), repeated `example:` lines, `tags:` (comma-separated, no `#`).
- Do not put `|` pipe tables or blank lines inside an entry.
- Dictionary tags are local to `.mddict` files (vault-wide dictionary tag bank); they are not note/PDF tags and do not appear in the tag graph.
<!-- core-rules:end -->

## Example

```text
# MarkSpace dictionary v1
filter: verbs, A1

sprechen
transcript: ˈʃpʁɛçn̩
translation: to speak
example: Kannst du Deutsch sprechen?
example: Wir sprechen über das Wetter.
tags: verbs, A1

Haus
transcript: haʊs
translation: house
example: Das Haus ist groß.
```

## Header

- First line: `# MarkSpace dictionary v1` (required).
- Next non-empty line may be `filter: …` (comma-separated tags). This is persisted UI filter state.

## Entries

- Separated by one or more blank lines.
- First line of an entry = word (required; non-empty when persisted).
- Optional metadata lines (order flexible within the entry):
  - `transcript: …` — single line (IPA / pinyin / romaji / etc.; free text)
  - `translation: …` — single line
  - `example: …` — repeatable; each line is one usage example
  - `tags: a, b` — comma-separated; no leading `#`
- Tags are case-preserved; duplicates in a list are ignored case-insensitively.

## Filter semantics

When `filter` lists one or more tags, the UI shows only items that include **all** of those tags (AND). Tools may update `filter` via `set_dictionary_filter`.

## Editing rules for agents

1. Prefer structured tools that parse → mutate → serialize.
2. If you must write raw text, preserve the header, blank-line separation, and never convert the file to a Markdown table.
3. Do not invent extra fields — items have only word, transcript, translation, examples, and tags.
