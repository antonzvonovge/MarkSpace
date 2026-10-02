import { describe, expect, it } from "vitest";
import {
  applyGridLayout,
  emptyDashboard,
  findFreeCell,
  parseDashboard,
  placeNoteWidget,
  placeRoutineWidget,
  placeTasksWidget,
  placeWeatherWidget,
  setNotePath,
  setTasksSource,
  previewRoutineReport,
  serializeDashboard,
  setWeatherPlace,
} from "./dashboardFormat";

describe("dashboardFormat", () => {
  it("round-trips an empty dashboard", () => {
    const src = emptyDashboard();
    expect(serializeDashboard(parseDashboard(src))).toBe(src);
    expect(parseDashboard(src).widgets).toEqual([]);
  });

  it("round-trips a routine widget and keeps its color", () => {
    const src = serializeDashboard({
      version: 1,
      cols: 12,
      color: "#2196f3",
      widgets: [
        { id: "w1", kind: "routine", routineId: "abc", x: 0, y: 0, w: 6, h: 4 },
      ],
    });
    const widget = parseDashboard(src).widgets[0];
    expect(widget?.kind === "routine" ? widget.routineId : null).toBe("abc");
    expect(parseDashboard(src).color).toBe("#2196f3");
    expect(serializeDashboard(parseDashboard(src))).toBe(src);
  });

  it("drops a color that is not in the palette", () => {
    const doc = parseDashboard(
      JSON.stringify({ version: 1, cols: 12, color: "#112233", widgets: [] }),
    );
    expect(doc.color).toBe("");
    expect(serializeDashboard(doc)).not.toContain("112233");
  });

  it("rejects a foreign JSON object", () => {
    expect(() => parseDashboard('{"hello":"world"}\n')).toThrow(
      /does not match the dashboard format/,
    );
  });

  it("rejects invalid JSON and a widget that leaves the grid", () => {
    expect(() => parseDashboard("{")).toThrow(/not valid JSON/);
    expect(() =>
      parseDashboard(
        JSON.stringify({
          version: 1,
          cols: 12,
          widgets: [{ id: "w1", kind: "routine", routineId: "abc", x: 8, y: 0, w: 6, h: 4 }],
        }),
      ),
    ).toThrow(/extends past the grid/);
  });

  it("places the next widget beside the first", () => {
    const first = placeRoutineWidget(
      { version: 1, cols: 12, color: "#2196f3", widgets: [] },
      "one",
      "a",
    );
    expect(first.color).toBe("#2196f3");
    const second = placeRoutineWidget(first, "two", "b");
    expect(second.widgets.map((widget) => widget.x)).toEqual([0, 6]);
    expect(findFreeCell(second.widgets).y).toBe(4);
  });

  it("copies grid geometry back onto widgets", () => {
    const doc = parseDashboard(emptyDashboard());
    const placed = placeRoutineWidget(doc, "one", "a");
    const next = applyGridLayout(placed, [{ i: "a", x: 2, y: 1, w: 4, h: 3 }]);
    expect(next.widgets[0]).toMatchObject({ x: 2, y: 1, w: 4, h: 3 });
  });

  it("places a weather widget and keeps the chosen city", () => {
    const placed = placeWeatherWidget(
      { version: 1, cols: 12, color: "#2196f3", widgets: [] },
      "w",
    );
    expect(placed.widgets[0]).toMatchObject({
      kind: "weather",
      place: "",
      x: 0,
      y: 0,
      w: 4,
      h: 5,
    });
    const chosen = setWeatherPlace(placed, "w", {
      name: "Tbilisi",
      admin: "Tbilisi",
      country: "Georgia",
      latitude: 41.69411,
      longitude: 44.83368,
    });
    const widget = chosen.widgets[0];
    expect(widget).toMatchObject({
      place: "Tbilisi",
      country: "Georgia",
      latitude: 41.6941,
      longitude: 44.8337,
    });
    const src = serializeDashboard(chosen);
    expect(serializeDashboard(parseDashboard(src))).toBe(src);
    const second = placeWeatherWidget(chosen, "w2");
    expect(second.widgets.map((item) => item.x)).toEqual([0, 4]);
  });

  it("places a tasks widget and keeps the chosen list", () => {
    const placed = placeTasksWidget(
      { version: 1, cols: 12, color: "#2196f3", widgets: [] },
      "w",
    );
    expect(placed.widgets[0]).toMatchObject({
      kind: "tasks",
      list: "",
      x: 0,
      y: 0,
      w: 6,
      h: 6,
    });
    const chosen = setTasksSource(placed, "w", { list: " Work " });
    expect(chosen.widgets[0]).toMatchObject({ kind: "tasks", list: "Work" });
    expect(chosen.widgets[0]).not.toHaveProperty("view");
    const src = serializeDashboard(chosen);
    expect(serializeDashboard(parseDashboard(src))).toBe(src);
    const today = setTasksSource(chosen, "w", { view: "today" });
    expect(today.widgets[0]).toMatchObject({ list: "", view: "today" });
    const todaySrc = serializeDashboard(today);
    expect(serializeDashboard(parseDashboard(todaySrc))).toBe(todaySrc);
    const overdue = setTasksSource(today, "w", { view: "overdue" });
    expect(overdue.widgets[0]).toMatchObject({ view: "overdue" });
  });

  it("places a note widget and keeps the chosen file", () => {
    const placed = placeNoteWidget(
      { version: 1, cols: 12, color: "#2196f3", widgets: [] },
      "w",
    );
    expect(placed.widgets[0]).toMatchObject({
      kind: "note",
      path: "",
      x: 0,
      y: 0,
      w: 6,
      h: 6,
    });
    const chosen = setNotePath(placed, "w", " /home/atott/notes/Today.md ");
    expect(chosen.widgets[0]).toMatchObject({
      kind: "note",
      path: "/home/atott/notes/Today.md",
    });
    const src = serializeDashboard(chosen);
    expect(serializeDashboard(parseDashboard(src))).toBe(src);
    const vaultNote = setNotePath(chosen, "w", "Projects/Today.md");
    expect(vaultNote.widgets[0]).toMatchObject({ path: "Projects/Today.md" });
    expect(setNotePath(chosen, "w", "../secret.md")).toBe(chosen);
  });

  it("rejects a note widget whose path leaves the vault", () => {
    expect(() =>
      parseDashboard(
        JSON.stringify({
          version: 1,
          cols: 12,
          widgets: [{ id: "w", kind: "note", path: "../secret.md", x: 0, y: 0, w: 6, h: 6 }],
        }),
      ),
    ).toThrow(/does not match the dashboard format/);
  });

  it("rejects a weather widget that has a city without coordinates", () => {
    expect(() =>
      parseDashboard(
        JSON.stringify({
          version: 1,
          cols: 12,
          widgets: [{ id: "w", kind: "weather", place: "Tbilisi", x: 0, y: 0, w: 4, h: 4 }],
        }),
      ),
    ).toThrow(/does not match the dashboard format/);
  });

  it("strips run metadata and truncates a long report", () => {
    const preview = previewRoutineReport(
      "# Morning\n\n- Trigger: schedule\n- Status: done\n\nFive letters.\n",
    );
    expect(preview).toEqual({ text: "Five letters.", truncated: false });
    const long = previewRoutineReport("x".repeat(20), 8);
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBeLessThanOrEqual(8);
  });
});
