---
description: Creates or updates MarkSpace agent skills under Skills/. Use when the user asks to add, write, draft, or improve a skill, or when they want the agent to learn a reusable workflow.
disable-model-invocation: false
---

# Create a MarkSpace skill

## What a skill is

A skill is one markdown note in the vault-root `Skills/` folder. The agent sees a short catalog (id + description) and loads the full body only when relevant (`read_skill`) or when the user forces it with `/skill-id` in chat.

## File rules

- Path: `Skills/<skill-id>.md`
- **skill-id** = filename stem only: lowercase letters, digits, hyphens (`meeting-notes`, `weekly-review`). Max 64 chars. No spaces, underscores, or nested folders.
- One skill = one `.md` file. Do not put skills elsewhere.

## Frontmatter (required shape)

```yaml
---
description: <third person: WHAT it does and WHEN to use it>
disable-model-invocation: false
---
```

- **description** (required for auto-discovery): third person; include both WHAT and WHEN; put trigger words the user might say. Keep it under ~300 characters when possible.
  - Good: `Drafts a weekly project status note. Use when the user asks for a status update, weekly summary, or progress report.`
  - Bad: `I help with status` / `Use this skill for docs`
- **disable-model-invocation: true** — skill is slash-only (`/skill-id`); omit from the auto catalog. Use when the skill is niche or expensive and should not self-trigger.
- **disable-model-invocation: false** (default) — model may call `read_skill` when the task matches the description.

## Body

Write clear, step-by-step instructions the agent must follow after loading the skill:

1. Goal / when this skill applies
2. Inputs to gather (ask via `ask_user` if needed)
3. Ordered steps (tools, note structure, naming)
4. Output format / template the agent should produce
5. Edge cases and what not to do

Prefer concrete MarkSpace paths, wiki-links, and tool names (`read_note`, `edit_note`, `create_note`, etc.). Do not assume Cursor-only concepts (MCP, terminal, git) unless the user asked for that workflow in this vault.

## How to create a skill for the user

1. Confirm purpose, trigger situations, and any fixed templates/phrasing the user wants — keep their verbatim wording when they provide it.
2. Choose a short **skill-id** from the purpose (e.g. `meeting-notes`).
3. If `Skills/<id>.md` already exists, `read_note` first and update with `edit_note` unless the user asked for a replacement.
4. Otherwise `create_note` at `Skills/<id>` then `write_note` / `edit_note` so the file has proper frontmatter + body (default `create_note` body is only a title — replace it).
5. Tell the user:
   - Path `Skills/<id>.md`
   - How to force it: type `/<id>` in chat
   - That auto-use depends on a good `description` (unless `disable-model-invocation: true`)

## Template to write

```markdown
---
description: <WHAT>. Use when <WHEN / trigger phrases>.
disable-model-invocation: false
---

# <Human title>

## Instructions

1. …
2. …

## Output format

…

## Examples

…
```

## Checklist before finishing

- [ ] Valid id and path under `Skills/`
- [ ] Description is third person, WHAT + WHEN
- [ ] Body is actionable without this meta-skill
- [ ] User knows `/<id>` and that the note is editable in the tree
