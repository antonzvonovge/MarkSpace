/** Specialist kinds the orchestrator may spawn via `run_specialist`. */
export type SpecialistKind =
  | "research"
  | "edit_notes"
  | "diagram"
  | "links"
  | "dict"
  | "habits"
  | "courses"
  | "terminal";

export const SPECIALIST_KIND_ORDER: readonly SpecialistKind[] = [
  "research",
  "edit_notes",
  "diagram",
  "links",
  "dict",
  "habits",
  "courses",
  "terminal",
];

export type SpecialistPreset = {
  kind: SpecialistKind;
  /** English UI label on the specialist card. */
  label: string;
  /** Short worker system prompt (role + constraints). */
  system: string;
  /** Tool names exposed to the worker (from the full agent tool map). */
  toolNames: readonly string[];
  /** Write specialist — participates in path-overlap mutex. */
  writes: boolean;
};

/** Parent Agent orchestrator surface without terminal. */
export const ORCHESTRATOR_TOOL_NAMES = [
  "list_folder",
  "search",
  "read_note",
  "open_note",
  "ask_user",
  "pick_vault_folder",
  "memory",
  "read_skill",
  "run_specialist",
] as const;

export const TERMINAL_TOOL_NAME = "run_terminal" as const;

/** Orchestrator tools for the current Settings toggle. */
export function orchestratorToolNames(
  terminalEnabled: boolean,
): readonly string[] {
  return terminalEnabled
    ? [...ORCHESTRATOR_TOOL_NAMES, TERMINAL_TOOL_NAME]
    : [...ORCHESTRATOR_TOOL_NAMES];
}

export type OrchestratorToolName = (typeof ORCHESTRATOR_TOOL_NAMES)[number];

const VAULT_READ_CORE = [
  "list_notes",
  "list_folder",
  "search_notes",
  "semantic_search",
  "list_tags",
  "get_file_tags",
  "read_note",
  "get_active_note",
  "open_note",
  "read_format_guide",
  "read_skill",
] as const;

export const SPECIALIST_PRESETS: Record<SpecialistKind, SpecialistPreset> = {
  research: {
    kind: "research",
    label: "Research",
    writes: false,
    system: [
      "You are a MarkSpace research specialist. Read-only: search and read the vault and web.",
      "Do not modify files. Return a clear summary of findings; list key paths.",
      "If you lack information to proceed, set needsClarification in your final answer.",
    ].join(" "),
    toolNames: [
      ...VAULT_READ_CORE,
      "read_diagram",
      "list_pages",
      "read_mdlnks_format",
      "read_links",
      "read_mddict_format",
      "read_dictionary",
      "read_mdhabit_format",
      "read_habits",
      "read_mdcourse_format",
      "read_course",
      "web_search",
      "fetch_url",
      "scrape_url",
      "read_file",
    ],
  },
  edit_notes: {
    kind: "edit_notes",
    label: "Editor",
    writes: true,
    system: [
      "You are a MarkSpace note editor. Create/edit markdown notes, folders, and assets.",
      "Prefer edit_note over write_note. Never raw-edit .drawio, .mdlnks, .mddict, .mdhabit, or .mdcourse — those need other specialists.",
      "To tag a note from its content, prefer auto_tag_note (reuses the vault tag catalog) over inventing tags in edit_note.",
      "Follow MarkSpace Markdown dialect; call read_format_guide when unsure.",
      "Diary daily notes: {project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md via open_or_create_daily_note.",
      "End with a summary and list changedPaths.",
    ].join(" "),
    toolNames: [
      "list_folder",
      "search_notes",
      "semantic_search",
      "read_note",
      "get_active_note",
      "open_note",
      "read_format_guide",
      "list_tags",
      "get_file_tags",
      "set_file_tags",
      "edit_note",
      "write_note",
      "create_note",
      "create_folder",
      "ensure_folder",
      "move_path",
      "delete_path",
      "delete_folder_if_empty",
      "save_attachment",
      "write_asset",
      "open_or_create_daily_note",
      "auto_tag_note",
      "translate_note",
      "clip_article",
      "read_file",
    ],
  },
  diagram: {
    kind: "diagram",
    label: "Diagram",
    writes: true,
    system: [
      "You are a MarkSpace Draw.io specialist. Create and fully edit one .drawio in this worker; do not assume another diagram specialist will continue.",
      "NEW diagram: one create_diagram call with mermaid (default for flowcharts, sequence, ER, org charts) or xml (precise layout, ArchiMate, cloud icons — call search_shapes / read_drawio_format first). Never create an empty file and fill it with mutate_diagram.",
      "EXISTING diagram: read_diagram then mutate_diagram for incremental edits. set_page only for a full page rewrite. Never raw-edit diagram XML via edit_note.",
      "End with a summary and changedPaths.",
    ].join(" "),
    toolNames: [
      "list_folder",
      "open_note",
      "read_drawio_format",
      "read_diagram",
      "list_pages",
      "get_page",
      "search_shapes",
      "create_diagram",
      "set_page",
      "mutate_diagram",
    ],
  },
  links: {
    kind: "links",
    label: "Links",
    writes: true,
    system: [
      "You are a MarkSpace .mdlnks links specialist. Use links tools only — never raw edit_note on .mdlnks.",
      "Call read_mdlnks_format when unsure of the format. End with summary and changedPaths.",
    ].join(" "),
    toolNames: [
      "list_folder",
      "open_note",
      "read_mdlnks_format",
      "read_links",
      "create_links",
      "add_link",
      "update_link",
      "remove_link",
      "reorder_links",
      "set_links_filter",
    ],
  },
  dict: {
    kind: "dict",
    label: "Dictionary",
    writes: true,
    system: [
      "You are a MarkSpace .mddict dictionary specialist. Use dictionary tools only — never raw edit_note on .mddict.",
      "Call read_mddict_format when unsure. Dictionary tags are separate from note/PDF tags. End with summary and changedPaths.",
    ].join(" "),
    toolNames: [
      "list_folder",
      "open_note",
      "read_mddict_format",
      "read_dictionary",
      "create_dictionary",
      "add_entry",
      "update_entry",
      "remove_entry",
      "reorder_entries",
      "set_dictionary_filter",
    ],
  },
  habits: {
    kind: "habits",
    label: "Habits",
    writes: true,
    system: [
      "You are a MarkSpace .mdhabit habit-tracker specialist. Use habits tools only — never raw edit_note on .mdhabit.",
      "Call read_mdhabit_format when unsure. End with summary and changedPaths.",
    ].join(" "),
    toolNames: [
      "list_folder",
      "open_note",
      "read_mdhabit_format",
      "read_habits",
      "create_habit_tracker",
      "add_habit",
      "update_habit",
      "remove_habit",
      "set_habit_day",
    ],
  },
  courses: {
    kind: "courses",
    label: "Courses",
    writes: true,
    system: [
      "You are a MarkSpace .mdcourse course-tracker specialist. Use course tools only — never raw edit_note on .mdcourse.",
      "Set weekdays (Mon–Sun) and time (HH:MM) with add_course_track / update_course_track; do not stuff clocks into when.",
      "Call read_mdcourse_format when unsure. End with summary and changedPaths.",
    ].join(" "),
    toolNames: [
      "list_folder",
      "open_note",
      "read_mdcourse_format",
      "read_course",
      "create_course",
      "add_course_track",
      "update_course_track",
      "remove_course_track",
      "set_course_day",
    ],
  },
  terminal: {
    kind: "terminal",
    label: "Terminal",
    writes: true,
    system: [
      "You are a MarkSpace terminal specialist. Run shell commands with run_terminal.",
      "Match the Host OS / shell line in this prompt — do not guess Windows vs Unix.",
      "The user must approve each command unless they enabled Allow for this chat.",
      "If the task is heavy, dangerous, or involves writing and running custom scripts, and it does not already say the user approved the plan: do not run commands; reply that you need confirmation of the plan (needs clarification).",
      "Do not edit notes, diagrams, .mdlnks, .mddict, .mdhabit, or .mdcourse via the shell — other specialists own those.",
      "Prefer list_folder / read_note to inspect vault files. End with a summary of commands and results.",
    ].join(" "),
    toolNames: ["run_terminal", "list_folder", "read_note"],
  },
};

export function isSpecialistKind(value: string): value is SpecialistKind {
  return Object.prototype.hasOwnProperty.call(SPECIALIST_PRESETS, value);
}

export function specialistLabel(kind: SpecialistKind): string {
  return SPECIALIST_PRESETS[kind].label;
}

/** Pick a subset of a tools record by name. Missing names are skipped. */
export function pickTools<T extends Record<string, unknown>>(
  tools: T,
  names: readonly string[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const name of names) {
    if (name in tools) {
      (out as Record<string, unknown>)[name] = tools[name];
    }
  }
  return out;
}

export function packCacheKey(
  mode: string,
  toolNames: readonly string[] | null | undefined,
): string {
  if (!toolNames || toolNames.length === 0) return mode;
  return `${mode}:${[...toolNames].sort().join(",")}`;
}
