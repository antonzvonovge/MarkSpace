/** Seeded vault skill: Skills/lexicon-reorganize.md (slash-only). */
export const LEXICON_REORGANIZE_SKILL_ID = "lexicon-reorganize";

export const LEXICON_REORGANIZE_SKILL_MARKDOWN = `---
description: Reorganizes a language-learning project's Lexicon folder into study-friendly categories. Use when the user runs /lexicon-reorganize or explicitly asks to reorganize, restructure, or tidy Lexicon.
disable-model-invocation: true
---

# Reorganize Lexicon

## Goal

Propose and apply a clearer folder layout under \`{project}/Lexicon/\` for language learning. Run only when the user invoked this skill (or clearly asked to reorganize Lexicon). Prefer Agent mode.

## Constraints

- Stay inside that project's \`Lexicon/\` folder.
- At most **2** folders under \`Lexicon/\` before the note filename (e.g. \`Lexicon/verbs/motion/go.md\`).
- Card filenames and frontmatter \`lemma\` must be in the **learning language** (not the user's native language). Native glosses belong in aliases / article body.
- Do **not** edit the user's \`## Notes\` section unless they explicitly ask.
- Do **not** delete cards without confirmation. Flag overlong "sentence" cards as candidates; wait for Agree before deleting.
- Prefer grouping that helps study (themes, word class, discourse markers, phrasal verbs) over neatness for its own sake.
- Do **not** reshuffle the project's sibling order (never move/rename the \`Lexicon\` folder itself among project root items).

## Instructions

1. Identify the target language-learning project:
   - Prefer the chat **Active project** if it is language-learning and has (or should have) \`Lexicon/\`.
   - If unclear, call \`ask_user\` with the candidate project paths.
2. Inventory cards: \`list_folder\` on \`{project}/Lexicon\` (recurse as needed). Note renames (native-language basenames → learning-language headword) and delete candidates (full sentences / >4 words) for yourself — do **not** dump those lists into the confirmation dialog unless asking about deletes.
3. Draft the **folder structure** only for the user (≤2 levels under Lexicon). Internally decide which cards go where, plus any renames.
4. Present via \`ask_user\` with options: **Agree**, **Change plan**, **Cancel**. The prompt must show **only the new structure** — folder paths and a short purpose each. Do **not** list which files move where. Optional: one line if there are delete candidates (names only). One-line rationale max. Do not apply until Agree (or a revised plan is agreed).
5. After Agree, \`run_specialist\` kind=\`edit_notes\` with a self-contained task that:
   - \`ensure_folder\` for each new category path.
   - \`move_path\` to place cards (keeps basename; siblings stay directories-first alphabetical).
   - \`rename_path\` when the basename must change (e.g. \`подросток.md\` → \`teenager.md\`).
   - \`edit_note\` / \`write_note\` to set frontmatter \`lemma\` to the learning-language headword after rename; put the old native form in \`aliases\` if missing.
   - Update broken wiki-links when practical.
6. Summarize briefly what changed. Remind the user they can run \`/lexicon-reorganize\` again later.

## Output format

\`ask_user\` prompt — structure only:

\`\`\`
Lexicon reorganize — {project}

New folders:
- Lexicon/discourse/ — linking / cohesive devices
- Lexicon/verbs/ — verbs and phrasal verbs
- Lexicon/topics/ — nouns and topic vocabulary

Rationale: easier to browse for IELTS writing.
\`\`\`

If anything would be deleted, add one line: \`Delete candidates: …\` (file names only). Never list moves/renames in this dialog.
`;
