import { describe, expect, it } from "vitest";
import {
  pushRecentCommandId,
  pushRecentPath,
  remapRecentPathList,
  RECENT_COMMANDS_LIMIT,
  RECENT_FILES_LIMIT,
} from "./settingsStore";

describe("pushRecentPath", () => {
  it("moves path to front and dedupes", () => {
    expect(pushRecentPath(["a.md", "b.md"], "b.md")).toEqual(["b.md", "a.md"]);
  });

  it("caps at RECENT_FILES_LIMIT", () => {
    const many = Array.from({ length: 20 }, (_, i) => `${i}.md`);
    const next = pushRecentPath(many, "new.md");
    expect(next).toHaveLength(RECENT_FILES_LIMIT);
    expect(next[0]).toBe("new.md");
  });
});

describe("pushRecentCommandId", () => {
  it("moves id to front and dedupes", () => {
    expect(pushRecentCommandId(["a", "b"], "b")).toEqual(["b", "a"]);
  });

  it("caps at RECENT_COMMANDS_LIMIT", () => {
    const many = Array.from({ length: 20 }, (_, i) => `cmd-${i}`);
    const next = pushRecentCommandId(many, "new");
    expect(next).toHaveLength(RECENT_COMMANDS_LIMIT);
    expect(next[0]).toBe("new");
  });
});

describe("remapRecentPathList", () => {
  it("remaps moved file and nested paths", () => {
    expect(
      remapRecentPathList(
        ["Proj/a.md", "Proj/sub/b.md", "Other/c.md"],
        "Proj",
        "Lang",
      ),
    ).toEqual(["Lang/a.md", "Lang/sub/b.md", "Other/c.md"]);
  });

  it("drops deleted paths", () => {
    expect(
      remapRecentPathList(["Proj/a.md", "Other/c.md"], "Proj/a.md", null),
    ).toEqual(["Other/c.md"]);
  });
});
