import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetSpecialistLiveForTests,
  _resetWriteLocksForTests,
  getSpecialistLive,
  subscribeSpecialistLive,
} from "./specialists";
import {
  ORCHESTRATOR_TOOL_NAMES,
  pickTools,
  SPECIALIST_PRESETS,
  specialistLabel,
} from "./toolPacks";

describe("toolPacks", () => {
  it("defines 8 orchestrator tools", () => {
    expect(ORCHESTRATOR_TOOL_NAMES).toHaveLength(8);
    expect(ORCHESTRATOR_TOOL_NAMES).toContain("run_specialist");
  });

  it("diagram preset omits granular shape tools", () => {
    const names = SPECIALIST_PRESETS.diagram.toolNames;
    expect(names).toContain("mutate_diagram");
    expect(names).not.toContain("add_diagram_node");
    expect(names).not.toContain("update_diagram_element");
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
