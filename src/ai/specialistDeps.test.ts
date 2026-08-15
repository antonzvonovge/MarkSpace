import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetSpecialistDepsForTests,
  beginSpecialistWave,
  formatPredecessorContext,
  waitingStatusForDeps,
  withPredecessorContext,
  type SpecialistDepResult,
} from "./specialistDeps";

const doneA: SpecialistDepResult = {
  ok: true,
  kind: "diagram",
  title: "Create flowchart",
  summary: "Created Project/flow.drawio with 5 shapes.",
  changedPaths: ["Project/flow.drawio"],
};

describe("specialist dependency wave", () => {
  beforeEach(() => {
    _resetSpecialistDepsForTests();
  });

  it("lets B wait for A and receive summary and changedPaths", async () => {
    const a = beginSpecialistWave({
      id: "diag",
      title: "Create flowchart",
      dependsOn: [],
    });
    const b = beginSpecialistWave({
      id: "embed",
      title: "Embed diagram",
      dependsOn: ["diag"],
    });

    const bWait = b.waitForDeps();
    let bUnlocked = false;
    const bPending = bWait.then((preds) => {
      bUnlocked = true;
      return preds;
    });
    await Promise.resolve();
    expect(bUnlocked).toBe(false);

    a.release(doneA);
    const preds = await bPending;
    expect(preds).toEqual([doneA]);
    expect(withPredecessorContext("Embed ![[Project/flow.drawio]]", preds)).toContain(
      "Project/flow.drawio",
    );
    expect(withPredecessorContext("Embed ![[Project/flow.drawio]]", preds)).toContain(
      "Create flowchart",
    );
    b.release({
      ok: true,
      kind: "edit_notes",
      title: "Embed diagram",
      summary: "Embedded.",
      changedPaths: ["Project/note.md"],
    });
  });

  it("rejects cyclic depends_on", async () => {
    const a = beginSpecialistWave({
      id: "a",
      title: "A",
      dependsOn: ["b"],
    });
    const b = beginSpecialistWave({
      id: "b",
      title: "B",
      dependsOn: ["a"],
    });
    await expect(a.waitForDeps()).rejects.toThrow(/Cyclic specialist depends_on/);
    await expect(b.waitForDeps()).rejects.toThrow(/Cyclic specialist depends_on/);
    a.release({
      ok: false,
      kind: "research",
      title: "A",
      summary: "cycle",
      changedPaths: [],
      error: "cycle",
    });
    b.release({
      ok: false,
      kind: "research",
      title: "B",
      summary: "cycle",
      changedPaths: [],
      error: "cycle",
    });
  });

  it("rejects unknown depends_on id after siblings register", async () => {
    const b = beginSpecialistWave({
      id: "embed",
      title: "Embed",
      dependsOn: ["missing"],
    });
    await expect(b.waitForDeps()).rejects.toThrow(
      /depends_on id not found in this round: missing/,
    );
    b.release({
      ok: false,
      kind: "edit_notes",
      title: "Embed",
      summary: "missing",
      changedPaths: [],
      error: "missing",
    });
  });

  it("does not block independent slots", async () => {
    const a = beginSpecialistWave({
      id: "a",
      title: "A",
      dependsOn: [],
    });
    const b = beginSpecialistWave({
      id: "b",
      title: "B",
      dependsOn: [],
    });
    const [pa, pb] = await Promise.all([a.waitForDeps(), b.waitForDeps()]);
    expect(pa).toEqual([]);
    expect(pb).toEqual([]);
    a.release(doneA);
    b.release({
      ok: true,
      kind: "research",
      title: "B",
      summary: "ok",
      changedPaths: [],
    });
  });

  it("aborts a waiter when the signal fires", async () => {
    const ac = new AbortController();
    const a = beginSpecialistWave({
      id: "diag",
      title: "Create flowchart",
      dependsOn: [],
      signal: ac.signal,
    });
    const b = beginSpecialistWave({
      id: "embed",
      title: "Embed diagram",
      dependsOn: ["diag"],
      signal: ac.signal,
    });
    const pending = b.waitForDeps();
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    b.release({
      ok: false,
      kind: "edit_notes",
      title: "Embed diagram",
      summary: "Cancelled.",
      changedPaths: [],
      error: "Cancelled.",
    });
    a.release(doneA);
  });

  it("rejects duplicate ids in the same wave and reuses after the wave ends", () => {
    const first = beginSpecialistWave({
      id: "diag",
      title: "A",
      dependsOn: [],
    });
    expect(() =>
      beginSpecialistWave({ id: "diag", title: "B", dependsOn: [] }),
    ).toThrow(/Duplicate specialist id/);
    first.release(doneA);
    const next = beginSpecialistWave({
      id: "diag",
      title: "C",
      dependsOn: [],
    });
    next.release(doneA);
  });

  it("formats predecessor context and waiting status", () => {
    const text = formatPredecessorContext([
      doneA,
      {
        ok: false,
        kind: "edit_notes",
        title: "Embed",
        summary: "failed",
        changedPaths: [],
        error: "note missing",
      },
    ]);
    expect(text).toContain("Prior specialist results");
    expect(text).toContain('ok=true');
    expect(text).toContain("Project/flow.drawio");
    expect(text).toContain("ok=false");
    expect(text).toContain("note missing");
    expect(waitingStatusForDeps(["Create flowchart"])).toBe(
      "Waiting for Create flowchart…",
    );
    expect(waitingStatusForDeps(["A", "B"])).toBe("Waiting for A, B…");
  });
});
