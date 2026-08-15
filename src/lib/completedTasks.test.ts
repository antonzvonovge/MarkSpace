import { describe, expect, it } from "vitest";
import {
  collectCompletedTaskIds,
  isCompletedCheckListItem,
  removeCompletedTaskLines,
} from "./completedTasks";

describe("isCompletedCheckListItem", () => {
  it("matches checked checkListItem blocks", () => {
    expect(
      isCompletedCheckListItem({
        type: "checkListItem",
        props: { checked: true },
      }),
    ).toBe(true);
    expect(
      isCompletedCheckListItem({
        type: "checkListItem",
        props: { checked: false },
      }),
    ).toBe(false);
    expect(
      isCompletedCheckListItem({
        type: "bulletListItem",
        props: { checked: true },
      }),
    ).toBe(false);
  });
});

describe("collectCompletedTaskIds", () => {
  it("returns outermost completed items and skips their children", () => {
    const ids = collectCompletedTaskIds([
      {
        id: "open",
        type: "checkListItem",
        props: { checked: false },
        children: [
          {
            id: "nested-done",
            type: "checkListItem",
            props: { checked: true },
          },
        ],
      },
      {
        id: "done",
        type: "checkListItem",
        props: { checked: true },
        children: [
          {
            id: "child-of-done",
            type: "checkListItem",
            props: { checked: true },
          },
          { id: "para", type: "paragraph" },
        ],
      },
      { id: "heading", type: "heading" },
    ]);
    expect(ids).toEqual(["nested-done", "done"]);
  });

  it("returns empty when nothing is checked", () => {
    expect(
      collectCompletedTaskIds([
        { id: "a", type: "checkListItem", props: { checked: false } },
        { id: "b", type: "paragraph" },
      ]),
    ).toEqual([]);
  });
});

describe("removeCompletedTaskLines", () => {
  it("removes completed items and keeps open ones", () => {
    const md = ["* [x] done", "* [ ] still open", "* [X] also done"].join("\n");
    expect(removeCompletedTaskLines(md)).toEqual({
      next: "* [ ] still open",
      removed: 2,
    });
  });

  it("removes nested content of a completed parent", () => {
    const md = [
      "* [x] done parent",
      "  * [ ] nested open",
      "  continuation",
      "* [ ] sibling",
    ].join("\n");
    expect(removeCompletedTaskLines(md)).toEqual({
      next: "* [ ] sibling",
      removed: 1,
    });
  });

  it("removes a nested completed item under an open parent", () => {
    const md = [
      "* [ ] parent",
      "  * [x] nested done",
      "    extra",
      "  * [ ] nested open",
    ].join("\n");
    expect(removeCompletedTaskLines(md)).toEqual({
      next: ["* [ ] parent", "  * [ ] nested open"].join("\n"),
      removed: 1,
    });
  });

  it("leaves fenced code and front-matter alone", () => {
    const md = [
      "---",
      "tags:",
      "  - [x] not a task",
      "---",
      "",
      "```",
      "* [x] example",
      "```",
      "",
      "* [x] real",
      "* [ ] keep",
    ].join("\n");
    expect(removeCompletedTaskLines(md)).toEqual({
      next: [
        "---",
        "tags:",
        "  - [x] not a task",
        "---",
        "",
        "```",
        "* [x] example",
        "```",
        "",
        "* [ ] keep",
      ].join("\n"),
      removed: 1,
    });
  });

  it("limits to completed items whose line overlaps the selection", () => {
    const md = ["* [x] first", "* [ ] mid", "* [x] last"].join("\n");
    const firstEnd = "* [x] first".length;
    expect(removeCompletedTaskLines(md, { from: 0, to: firstEnd })).toEqual({
      next: ["* [ ] mid", "* [x] last"].join("\n"),
      removed: 1,
    });
  });

  it("matches numbered completed tasks", () => {
    const md = ["1. [x] done", "2. [ ] open"].join("\n");
    expect(removeCompletedTaskLines(md)).toEqual({
      next: "2. [ ] open",
      removed: 1,
    });
  });

  it("is a no-op when nothing matches", () => {
    const md = "* [ ] open\n\nparagraph";
    expect(removeCompletedTaskLines(md)).toEqual({ next: md, removed: 0 });
  });
});
