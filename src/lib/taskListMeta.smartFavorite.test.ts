import { describe, expect, it } from "vitest";
import {
  isTasksSmartFavorited,
  parseTasksSmartFavorite,
  tasksSmartFavoriteLabel,
  tasksSmartFavoritePath,
} from "./taskListMeta";

describe("tasks smart favorites", () => {
  it("builds and parses virtual keys", () => {
    expect(tasksSmartFavoritePath("inbox")).toBe("markspace:tasks-view:inbox");
    expect(tasksSmartFavoritePath("today")).toBe("markspace:tasks-view:today");
    expect(tasksSmartFavoritePath("overdue")).toBe(
      "markspace:tasks-view:overdue",
    );
    expect(parseTasksSmartFavorite("markspace:tasks-view:today")).toBe("today");
    expect(parseTasksSmartFavorite("markspace:tasks-view:filters")).toBeNull();
  });

  it("treats Tasks/Inbox as inbox smart view", () => {
    expect(parseTasksSmartFavorite("Tasks/Inbox")).toBe("inbox");
    expect(tasksSmartFavoriteLabel("inbox")).toBe("Inbox");
  });

  it("detects favorited smart views including legacy Inbox path", () => {
    expect(
      isTasksSmartFavorited("inbox", ["markspace:tasks-view:inbox"]),
    ).toBe(true);
    expect(isTasksSmartFavorited("inbox", ["Tasks/Inbox"])).toBe(true);
    expect(isTasksSmartFavorited("today", ["Tasks/Inbox"])).toBe(false);
  });
});
