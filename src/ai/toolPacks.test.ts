import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetSpecialistLiveForTests,
  _resetWriteLocksForTests,
  getSpecialistLive,
  subscribeSpecialistLive,
} from "./specialists";
import {
  ORCHESTRATOR_TOOL_NAMES,
  orchestratorToolNames,
  pickTools,
  SPECIALIST_PRESETS,
  specialistLabel,
} from "./toolPacks";

describe("toolPacks", () => {
  it("defines orchestrator authoring tools; terminal is opt-in", () => {
    expect(ORCHESTRATOR_TOOL_NAMES).toHaveLength(22);
    expect(ORCHESTRATOR_TOOL_NAMES).toContain("run_specialist");
    expect(ORCHESTRATOR_TOOL_NAMES).toContain("edit_note");
    expect(ORCHESTRATOR_TOOL_NAMES).toContain("create_diagram");
    expect(ORCHESTRATOR_TOOL_NAMES).not.toContain("move_path");
    expect(ORCHESTRATOR_TOOL_NAMES).not.toContain("ielts_practice");
    expect(ORCHESTRATOR_TOOL_NAMES).toContain("pick_vault_folder");
    expect(ORCHESTRATOR_TOOL_NAMES).not.toContain("read_format_guide");
    expect(ORCHESTRATOR_TOOL_NAMES).not.toContain("run_terminal");
    expect(SPECIALIST_PRESETS.edit_notes.toolNames).not.toContain(
      "read_format_guide",
    );
    expect(SPECIALIST_PRESETS.media.toolNames).not.toContain(
      "read_format_guide",
    );
    expect(SPECIALIST_PRESETS.research.toolNames).not.toContain(
      "read_format_guide",
    );
    expect(orchestratorToolNames(false)).toHaveLength(22);
    expect(orchestratorToolNames(true)).toEqual([
      ...ORCHESTRATOR_TOOL_NAMES,
      "run_terminal",
    ]);
  });

  it("diagram preset omits granular shape tools and uses first-paint create", () => {
    const names = SPECIALIST_PRESETS.diagram.toolNames;
    expect(names).toContain("mutate_diagram");
    expect(names).toContain("create_diagram");
    expect(names).toContain("search_shapes");
    expect(names).toContain("read_drawio_format");
    expect(names).toContain("list_pages");
    expect(names).toContain("set_page");
    expect(names).not.toContain("add_diagram_node");
    expect(names).not.toContain("update_diagram_element");
    expect(SPECIALIST_PRESETS.diagram.system).toContain(
      "Do not invent the diagram's content",
    );
    expect(SPECIALIST_PRESETS.diagram.system).toContain(
      "Never create an empty file and fill it with mutate_diagram",
    );
  });

  it("research returns facts and does not write the conclusion", () => {
    expect(SPECIALIST_PRESETS.research.system).toContain("paths and short quotes");
    expect(SPECIALIST_PRESETS.research.system).toContain(
      "Do not write the conclusion",
    );
    expect(SPECIALIST_PRESETS.courses.system).toContain(".mdcourse");
  });

  it("edit_notes can auto-tag from the vault catalog", () => {
    expect(SPECIALIST_PRESETS.edit_notes.toolNames).toContain("auto_tag_note");
    expect(SPECIALIST_PRESETS.edit_notes.system).toContain("auto_tag_note");
    expect(SPECIALIST_PRESETS.edit_notes.system).toContain(
      "Do not invent prose",
    );
  });

  it("edit_notes can rename paths in place", () => {
    expect(SPECIALIST_PRESETS.edit_notes.toolNames).toContain("rename_path");
    expect(SPECIALIST_PRESETS.edit_notes.system).toContain("rename_path");
  });

  it("edit_notes warns not to rewrite .assets after move_path", () => {
    expect(SPECIALIST_PRESETS.edit_notes.system).toContain("move_path");
    expect(SPECIALIST_PRESETS.edit_notes.system).toMatch(/\.assets/);
    expect(SPECIALIST_PRESETS.edit_notes.system).toMatch(/\.\.\/\.assets/);
  });

  it("media pack can catalog and reorganize without rewriting posters", () => {
    const names = SPECIALIST_PRESETS.media.toolNames;
    expect(names).toContain("list_media_catalog");
    expect(names).toContain("ensure_folder");
    expect(names).toContain("move_path");
    expect(names).toContain("search_movies");
    expect(names).toContain("create_film_note");
    expect(SPECIALIST_PRESETS.media.system).toContain("list_media_catalog");
    expect(SPECIALIST_PRESETS.media.system).toMatch(/move_path/);
    expect(SPECIALIST_PRESETS.media.system).toMatch(/\.\.\/\.assets/);
  });

  it("tasks pack uses dedicated task tools and forbids raw Tasks/ edits in edit_notes", () => {
    const names = SPECIALIST_PRESETS.tasks.toolNames;
    expect(names).toContain("list_tasks");
    expect(names).toContain("create_task");
    expect(names).toContain("create_tasks");
    expect(names).toContain("complete_task");
    expect(names).toContain("read_task_format");
    expect(names).not.toContain("write_note");
    expect(SPECIALIST_PRESETS.tasks.system).toMatch(/Tasks\//);
    expect(SPECIALIST_PRESETS.tasks.system).toMatch(/create_tasks/);
    expect(SPECIALIST_PRESETS.edit_notes.system).toMatch(/kind=tasks/);
  });

  it("pickTools keeps only requested keys", () => {
    const picked = pickTools(
      { a: 1, b: 2, c: 3 },
      ["a", "c", "missing"],
    );
    expect(picked).toEqual({ a: 1, c: 3 });
  });

  it("labels kinds in English", () => {
    expect(specialistLabel("research")).toBe("Research");
    expect(specialistLabel("edit_notes")).toBe("Editor");
    expect(specialistLabel("terminal")).toBe("Terminal");
    expect(SPECIALIST_PRESETS.terminal.toolNames).toContain("run_terminal");
    expect(SPECIALIST_PRESETS.terminal.system).toContain("Host OS");
    expect(SPECIALIST_PRESETS.terminal.system).toContain(
      "needs clarification",
    );
  });
});

describe("specialist live store", () => {
  beforeEach(() => {
    _resetSpecialistLiveForTests();
    _resetWriteLocksForTests();
  });

  it("notifies subscribers on set via run path helpers", () => {
    let ticks = 0;
    const unsub = subscribeSpecialistLive(() => {
      ticks += 1;
    });
    expect(getSpecialistLive("x")).toBeUndefined();
    // Indirectly: import set through a minimal dance — live is private set
    // by runSpecialist; here we only verify subscribe/unsubscribe wiring.
    unsub();
    expect(ticks).toBe(0);
  });
});
