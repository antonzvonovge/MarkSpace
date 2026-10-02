import { describe, expect, it } from "vitest";
import {
  applyGridLayout,
  emptyDashboard,
  findFreeCell,
  parseDashboard,
  placeRoutineWidget,
  previewRoutineReport,
  serializeDashboard,
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
    expect(parseDashboard(src).widgets[0]?.routineId).toBe("abc");
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
