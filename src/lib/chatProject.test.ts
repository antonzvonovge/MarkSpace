import { describe, expect, it } from "vitest";
import { projectPathForVaultItem } from "./chatProject";

describe("projectPathForVaultItem", () => {
  it("returns the first-level project for nested vault paths", () => {
    expect(projectPathForVaultItem("Journal/2026/08/note.md")).toBe("Journal");
  });

  it("returns null for reserved root folders", () => {
    expect(projectPathForVaultItem("Incoming/inbox.md")).toBeNull();
    expect(projectPathForVaultItem("Tasks/todo.md")).toBeNull();
    expect(projectPathForVaultItem("Skills/skill.md")).toBeNull();
  });

  it("returns null for root-level files", () => {
    expect(projectPathForVaultItem("readme.md")).toBeNull();
  });

  it("returns a root-level project folder", () => {
    expect(projectPathForVaultItem("Journal")).toBe("Journal");
  });
});
