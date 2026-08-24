# MarkSpace course format (`.mdcourse`)

`.mdcourse` files are limited-term course trackers — not Markdown. Agents must prefer dedicated course tools (`read_course`, `add_course_track`, `update_course_track`, `remove_course_track`, `set_course_day`, `create_course`) over raw `edit_note` / `write_note`.

Call `read_mdcourse_format` for this full guide when unsure.

<!-- core-rules:start -->
- `.mdcourse` is a course-tracker document, not Markdown. Do not use GFM tables, wiki-links, or front-matter.
- Prefer course tools over raw `edit_note` / `write_note` on `.mdcourse` files.
- Line 1 must be exactly `# MarkSpace course v1`.
- Required header field: `created: YYYY-MM-DD` (local calendar day the file was created). Do not change `created`. There is no `year:` field.
- Tracks are separated by a blank line; file order is sidebar order. The top bar sorts tracks by duration with the longest at the bottom (`ongoing` is longest).
- Each track starts with its **name** (unique in the file, case-insensitive).
- Required: `question:` (day quiz), `start: YYYY-MM-DD`, and either `days: N` (N ≥ 1) or `ongoing: true` — not both.
- Optional `weekdays:` is a space-separated list of `Mon`…`Sun` (or `1`–`7` with Monday = 1). Omit or `all` = every day in the window. The track is inactive on other weekdays.
- Optional `time:` is one or more 24-hour `HH:MM` clocks (space-separated), in the same order as daily segments. Optional `when:` is a free-text hint (not a clock). Optional `color:` is a project-palette hex. Optional `times:` is 1–8 (default 1), daily multiplicity.
- Log: one compact `log: YYYY-MM-DD:k …` line. `k` is 0…times. Missing days are skip. `k=0` is an explicit miss. Do not use `dates:` / `no:`.
- Do not put `|` pipe tables or blank lines inside a track entry.
<!-- core-rules:end -->

## Example

```text
# MarkSpace course v1
created: 2026-08-24

Ascorutin
question: Did you take Ascorutin as prescribed?
when: after meals
time: 08:00 14:00 20:00
weekdays: Mon Tue Wed Thu Fri
times: 3
start: 2026-08-24
days: 28
color: #2196f3
log: 2026-08-24:2 2026-08-25:0

SPF
question: Did you apply SPF?
when: morning
time: 09:30
times: 1
start: 2026-08-24
ongoing: true
log: 2026-08-24:1
```

## Header

- First line: `# MarkSpace course v1` (required).
- `created: …` — local date.

## Tracks

- Separated by one or more blank lines.
- First line of an entry = track name (required, unique ignoring case).
- Metadata (order flexible):
  - `question: …` — single line; shown in the day quiz
  - `when: …` — optional free-text hint
  - `time: HH:MM …` — optional 24-hour clocks
  - `weekdays: Mon Tue …` — optional; omit = every day
  - `color: #rrggbb` — optional project color
  - `times: N` — optional 1–8; default 1
  - `start: YYYY-MM-DD` — required
  - `days: N` **or** `ongoing: true`
  - `log: YYYY-MM-DD:k …` — optional

## Editing rules for agents

1. Prefer structured tools that parse → mutate → serialize.
2. If you must write raw text, preserve the header, blank-line separation, and never convert the file to a Markdown table.
3. To log a day, set `k` on that ISO date (0 = miss, times = complete). To skip, omit the day from `log`.
4. Set `weekdays` and `time` with `add_course_track` / `update_course_track`. Do not invent a clock in `when:`.
