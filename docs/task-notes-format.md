# MarkSpace task notes

Task notes live under the reserved vault-root folder **`Tasks/`** (not a project). It is hidden from the workspace tree and shown only in the Tasks sidebar section; task notes are excluded from the graph. Each `.md` file is one task (Todoist-style card). Nested folders under `Tasks/` are lists (“projects”); `Tasks/Inbox/` is quick capture.

Agents and UIs must prefer dedicated task helpers over inventing a second format.

<!-- core-rules:start -->
- One task = one `.md` under `Tasks/<list>/` (not a special extension). Exclude `.folder.md`.
- `Tasks/` is a reserved root folder (like Incoming): omitted from the workspace tree / wiki-link picker, not a vault project, excluded from the graph.
- Lists are folders directly under `Tasks/` (e.g. `Inbox/`, `Work/`). Task files in a list are a **flat** folder listing — hierarchy is not expressed with nested folders.
- YAML frontmatter keys: `id` (stable UUID), `status` (`open` | `done`), optional `due` (`YYYY-MM-DD`), `priority` (1–4, 1 = highest), `labels` (string list), `created` (`YYYY-MM-DD` or ISO), optional `parent` (**UUID of the parent task**, not a path or title). Preserve unknown keys.
- Nesting is **two levels only**: a root task (`parent` empty) and child tasks whose `parent` is the parent’s `id`. No grandchildren — nesting a parent re-parents its children onto the new parent (or clears them to roots when promoting).
- Body starts with `# Title`. Optional legacy `## Subtasks` checklist (GFM `- [ ]` / `- [x]`) for freeform lines inside the note; structured hierarchy uses separate child `.md` files + `parent` id. Optional `## Comments` with append-only `### YYYY-MM-DD HH:mm` blocks (local time).
- Images in comments use note-relative `.assets/…` (sibling folder), e.g. `![](.assets/shot.png)`.
- Index and filters scan only `Tasks/**/*.md`. Do not treat checklists outside `Tasks/` as tasks.
- List order follows vault `order.json` (tree order under each list folder). Sibling order (among roots or among children of one parent) follows that order. Dragging a task onto another sets `parent` to the parent’s `id` (file is kept). Outdent clears `parent`.
- Today / Upcoming views may sort by priority and due; Inbox and per-list views keep manual order.
<!-- core-rules:end -->

## Layout

```text
Tasks/
  Inbox/
    buy-milk.md           # id: …
    call-shop.md          # parent: <buy-milk id>
  Work/
    send-report.md
    .assets/
      shot.png
```

## Example

```markdown
---
id: 7f3a2c1e-9b4d-4e2a-a1c0-1234567890ab
status: open
due: 2026-08-28
priority: 2
labels: [work, report]
created: 2026-08-27
---

# Send report

## Comments

### 2026-08-27 14:02

Looks good, see screenshot:

![](.assets/shot.png)

### 2026-08-27 18:10

Sent to boss.
```

Child task example:

```markdown
---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
status: open
due: 2026-08-27
parent: 7f3a2c1e-9b4d-4e2a-a1c0-1234567890ab
created: 2026-08-27
---

# Draft numbers
```

## Frontmatter

| Key | Required | Notes |
|-----|----------|--------|
| `id` | yes | Stable UUID for this task; assigned on create / migration |
| `status` | yes | `open` or `done` (default `open` when missing) |
| `due` | no | Local calendar day `YYYY-MM-DD` |
| `priority` | no | Integer 1–4; omit or empty = none |
| `labels` | no | YAML list or comma string; normalized like note tags |
| `created` | no | Prefer `YYYY-MM-DD`; ISO timestamps accepted when reading |
| `parent` | no | Parent task’s `id` (UUID); omit for roots. Legacy path values are migrated to ids |

## Body sections

- **Title** — first ATX `# ` heading; if missing, file stem is the display title.
- **`## Subtasks`** — optional legacy checklist only (other lines ignored by the structured parser but kept on round-trip when using full-body editors). Prefer child task files + `parent` id for hierarchy.
- **`## Comments`** — chronological blocks; each starts with `### YYYY-MM-DD HH:mm` (24h). Body is markdown until the next `###` date heading or EOF.
- Content between the title and `## Subtasks` / `## Comments` is optional description; the structured UI may omit editing it in Phase 1.

## Assets

Same as ordinary notes: `write_asset` writes under the note’s sibling `.assets/` and returns a `.assets/name` URL for markdown embeds.
