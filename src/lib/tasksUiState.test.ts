import { describe, expect, it } from "vitest";
import { tasksListContextKey } from "./tasksUiState";

describe("tasksListContextKey", () => {
  it("maps sidebar views and named lists to stable keys", () => {
    expect(tasksListContextKey("inbox", "")).toBe("inbox");
    expect(tasksListContextKey("today", "Inbox")).toBe("today");
    expect(tasksListContextKey("filters", "Work")).toBe("filters");
    expect(tasksListContextKey("all", "")).toBe("all");
    expect(tasksListContextKey("all", "Work")).toBe("list:Work");
  });
});
