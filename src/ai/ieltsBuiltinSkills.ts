import { splitFrontmatter } from "../lib/noteFrontmatter";
import type { LoadedSkill, SkillMeta } from "./skills";

function parseMeta(id: string, raw: string): SkillMeta {
  const { data } = splitFrontmatter(raw);
  const description =
    typeof data?.description === "string" ? data.description.trim() : "";
  const disableRaw = data?.["disable-model-invocation"];
  const disableModelInvocation =
    disableRaw === true ||
    disableRaw === "true" ||
    disableRaw === 1 ||
    disableRaw === "1";
  return {
    id,
    path: `Skills/${id}.md`,
    description,
    disableModelInvocation,
  };
}

const WRITING = `---
description: Runs an IELTS General Training Writing practice session (Task 1 letters, Task 2 essays, or a rewrite). Use when the user says IELTS writing, Task 1, Task 2, /ielts-writing, or Saturday rewrite.
disable-model-invocation: false
---

# IELTS Writing

## Instructions

1. Call pick_vault_folder first for the session note folder (do not use ask_user for the path). Then ask_user for variant: Task 1 formal / semi-formal / informal letter, Task 2 opinion / discussion / problem-solution / advantages-disadvantages, or Rewrite a previous piece in that folder (list_folder / search if needed).
2. Call ielts_practice action=start with skill=writing, folder, variant. Read existing_notes / existing_topics from the result — invent a NEW prompt theme; do not repeat those topics.
3. Invent one GT prompt. Call ielts_practice action=set_secret with examiner notes (band expectations) — never print the secret in chat.
4. Show the exam prompt via ielts_practice action=show_paper (title, intro = the letter/essay prompt in English, one question kind=long, placeholder with the word count). Do not paste the prompt as a long chat message. Do not call set_timer. Do not write chat text while the paper is open.
5. When show_paper returns (they pressed Submit): immediately grade, then write ONE recap in the user's native language (score + traps). Do not repeat that recap. Then save_note and end. After end: stop — no more tools, no more “done” messages.

Do not claim this is an official Cambridge score. Public web search only if they ask to find a sample prompt — never pirate paid books.
`;

const READING = `---
description: Runs an IELTS General Training Reading practice session (Section 1, 2, or 3). Use when the user says IELTS reading, True/False/Not Given, /ielts-reading, or Tuesday reading.
disable-model-invocation: false
---

# IELTS Reading

## Instructions

1. pick_vault_folder for the save folder. Then ask_user: Section 1, 2, 3, or a short mini-set.
2. ielts_practice start skill=reading. Use existing_topics from the result to pick a NEW passage theme (do not reuse listed topics).
3. Generate GT-style passage(s) and numbered questions. set_secret with the full answer key and trap notes. Do not show the key until grade.
4. Call show_paper: intro = the passage(s) in English; questions as kind=gap (completion) or kind=choice (TRUE/FALSE/NOT GIVEN, matching, MCQ) with options. Do not dump the questions as chat markdown. Do not call set_timer. Do not write chat text while the paper is open.
5. When show_paper returns: immediately grade, then ONE compact Question / Yours / Correct / trap table and score in the user's native language. Do not repeat it. save_note then end. After end: stop.

Indicative practice only. No pirated Cambridge PDFs.
`;

const LISTENING = `---
description: Runs an IELTS General Training Listening practice session with generated audio (or questions on a public web clip). Use when the user says IELTS listening, /ielts-listening, or Thursday listening.
disable-model-invocation: false
---

# IELTS Listening

## Instructions

1. pick_vault_folder for the save folder. Then ask_user: one section vs sections 1–4. If they ask to find public audio, web_search official/public pages only (British Council, IELTS.org sample, BBC) and write questions for that clip — do not call it Cambridge.
2. ielts_practice start skill=listening. Put a topic slug in variant (e.g. section-1-lakeside-cabin). Use existing_topics from start and invent a different GT scenario. set_secret with answer key + full script.
3. Listening audio then ONE paper:
   - One section: one synthesize_audio, then one show_paper (questions 1–10).
   - Full test (sections 1–4): one synthesize_audio with all four scripts in order (short pause / “Now turn to section N” lines between them). Then ONE show_paper with questions 1–40 and headings Section 1 … Section 4. Never call show_paper four times. Never wait for four Submits.
   Intro = exam instructions. Gaps with ____ ; matching uses a shared options bank. Do not print questions in chat. Do not call set_timer. Do not mention Ready or ask them to Submit — the widget has Submit. Write nothing after show_paper until it returns.
4. When that single show_paper returns: immediately grade, then ONE native-language recap (score + traps; script stays English). save_note with a wiki link to the audio. end. After end: stop — do not write “Готово / done / note is open” again, do not open_note again, do not repeat the recap. Empty answers are misses.

Never print the script or key before grade.
`;

const SPEAKING = `---
description: Runs an IELTS Speaking practice session (Part 1, 2, 3) as an examiner in this chat. Use when the user says IELTS speaking, cue card, /ielts-speaking, or Friday speaking.
disable-model-invocation: false
---

# IELTS Speaking

## Instructions

1. pick_vault_folder for the save folder. Then ielts_practice start skill=speaking. Rotate cue-card / Part 1 themes away from existing_topics in the start result.
2. Be a concise examiner. Part 1: 4–5 short questions in chat. Part 2: show_paper with intro = the cue card (no questions so the mic stays enabled). Do not call set_timer. Part 3: 4–6 abstract follow-ups. Do not lecture.
3. They may speak via the microphone or type. After End session: ONE recap in the user's native language (fluency, LR, grammar; 3 fixes). Mention pronunciation only if Azure scores appear. Then save_note and end. After end: stop.

Indicative practice only.
`;

const RAW: Record<string, string> = {
  "ielts-writing": WRITING,
  "ielts-reading": READING,
  "ielts-listening": LISTENING,
  "ielts-speaking": SPEAKING,
};

export function listBuiltinIeltsSkills(): SkillMeta[] {
  return Object.entries(RAW).map(([id, raw]) => parseMeta(id, raw));
}

export function loadBuiltinIeltsSkill(id: string): LoadedSkill | null {
  const raw = RAW[id];
  if (!raw) return null;
  const meta = parseMeta(id, raw);
  const body = raw.replace(/^---[\s\S]*?---\s*/, "");
  return { meta, body: body.trimStart(), raw };
}
