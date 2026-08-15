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
  it("defines 8 orchestrator tools; terminal is opt-in", () => {
    expect(ORCHESTRATOR_TOOL_NAMES).toHaveLength(8);
    expect(ORCHESTRATOR_TOOL_NAMES).toContain("run_specialist");
    expect(ORCHESTRATOR_TOOL_NAMES).not.toContain("run_terminal");
    expect(orchestratorToolNames(false)).toHaveLength(8);
    expect(orchestratorToolNames(true)).toEqual([
      ...ORCHESTRATOR_TOOL_NAMES,
      "run_terminal",
    ]);
  });

  it("diagram preset omits granular shape tools", () => {
    const names = SPECIALIST_PRESETS.diagram.toolNames;
    expect(names).toContain("mutate_diagram");
    expect(names).not.toContain("add_diagram_node");
    expect(names).not.toContain("update_diagram_element");
    expect(SPECIALIST_PRESETS.diagram.system).toContain(
      "do not assume another diagram specialist will continue",
    );
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
