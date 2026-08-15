import { describe, expect, it } from "vitest";
import { _test } from "./autoTagNote";

const { extractJsonValue, tagsFromModelOutput, mergeTags, noteStem, buildSystem } =
  _test;

describe("autoTagNote helpers", () => {
  it("strips note stem extension", () => {
    expect(noteStem("Folder/Hello.md")).toBe("Hello");
    expect(noteStem("Hello.MD")).toBe("Hello");
  });

  it("parses tags from JSON object, array, or fenced output", () => {
    expect(tagsFromModelOutput(extractJsonValue('{"tags":["work","ai"]}'))).toEqual(
      ["work", "ai"],
    );
    expect(tagsFromModelOutput(extractJsonValue('["inbox"]'))).toEqual(["inbox"]);
    expect(
      tagsFromModelOutput(
        extractJsonValue('```json\n{"tags":["project/markspace"]}\n```'),
      ),
    ).toEqual(["project/markspace"]);
  });

  it("prefers suggested tags, then existing, and caps at 4", () => {
    expect(mergeTags(["work", "inbox"], ["work", "ai-agents"])).toEqual([
      "work",
      "ai-agents",
      "inbox",
    ]);
    expect(
      mergeTags(
        ["old-a", "old-b"],
        ["one", "two", "three", "four", "five"],
      ),
    ).toEqual(["one", "two", "three", "four"]);
  });

  it("asks the model to prefer the vault catalog", () => {
    const system = buildSystem(["work", "project/markspace"]);
    expect(system).toContain("project/markspace");
    expect(system).toContain("Prefer exact names from the existing vault catalog");
    expect(system).toContain("Never more than 4");
  });
});
