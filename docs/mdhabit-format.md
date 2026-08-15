# MarkSpace habits format (`.mdhabit`)

`.mdhabit` files are yearly habit trackers — not Markdown. Agents must prefer dedicated habits tools (`read_habits`, `add_habit`, `update_habit`, `remove_habit`, `set_habit_day`, `create_habit_tracker`) over raw `edit_note` / `write_note`.

Call `read_mdhabit_format` for this full guide when unsure.

<!-- core-rules:start -->
- `.mdhabit` is a habit-tracker document, not Markdown. Do not use GFM tables, wiki-links, or front-matter.
- Prefer habits tools over raw `edit_note` / `write_note` on `.mdhabit` files.
- Line 1 must be exactly `# MarkSpace habits v1`.
- Required header fields: `year: 2026` (calendar year of the grid) and `created: YYYY-MM-DD` (local calendar day the file was created). Do not change `created`.
- Habit entries are separated by a blank line; file order is display order.
- Each entry starts with the habit **name** (unique in the file, case-insensitive).
- Required `question:` (single line) is the Yes/No prompt in the day quiz. Optional `color:` is a project-palette hex (`#2196f3`) or omit / empty for none.
- Explicit Yes days: one compact `dates: YYYY-MM-DD …` line. Explicit No days: one compact `no: YYYY-MM-DD …` line. Skip / unanswered days are omitted entirely. Do not treat missing dates as No.
- Bare `YYYY-MM-DD` lines (legacy Yes) are still accepted when reading. Legacy `logged:` header days without a Yes become `no:` on parse.
- Do not put `|` pipe tables or blank lines inside an entry.
<!-- core-rules:end -->

## Example

```text
# MarkSpace habits v1
year: 2026
created: 2026-08-15

Water
question: Did you drink 2L of water?
color: #2196f3
dates: 2026-08-15 2026-08-16
no: 2026-08-17

Exercise
question: Did you work out?
color: #4caf50
dates: 2026-08-15
no: 2026-08-16
```

## Header

- First line: `# MarkSpace habits v1` (required).
- `year: …` — integer year shown on the 3×4 calendar.
- `created: YYYY-MM-DD` — local date; days before this with no answers paint gray in the UI.

## Entries

- Separated by one or more blank lines.
- First line of an entry = habit name (required, unique ignoring case).
- Metadata (order flexible):
  - `question: …` — single line; shown as the day-quiz prompt
  - `color: #rrggbb` — optional; must be a project color swatch or it is dropped
  - `dates: YYYY-MM-DD …` — optional; space-separated **Yes** days
  - `no: YYYY-MM-DD …` — optional; space-separated **No** days
- A day must not appear on both `dates:` and `no:` (Yes wins if both are present).
- Three states per habit per day: Yes (`dates:`), No (`no:`), skip (absent).

## Editing rules for agents

1. Prefer structured tools that parse → mutate → serialize.
2. If you must write raw text, preserve the header, blank-line separation, and never convert the file to a Markdown table.
3. To record Yes, add the day to `dates:` and remove it from `no:`. To record No, add it to `no:` and remove it from `dates:`. To skip, remove the day from both. Do not invent extra keys.
