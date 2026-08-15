import { describe, expect, it } from "vitest";
import {
  formatPaletteShortcut,
  listPaletteCommands,
  type PaletteCommand,
} from "./CommandPalette";
import { RECENT_COMMANDS_LIMIT } from "../lib/settingsStore";

describe("formatPaletteShortcut", () => {
  it("joins modifiers with plus on Windows/Linux", () => {
    expect(
      formatPaletteShortcut({ mod: true, shift: true, key: "T" }, false),
    ).toBe("Ctrl+Shift+T");
  });

  it("uses symbols on macOS", () => {
    expect(
      formatPaletteShortcut({ mod: true, shift: true, key: "T" }, true),
    ).toBe("⇧⌘T");
  });

  it("omits unused modifiers", () => {
    expect(formatPaletteShortcut({ mod: true, key: "S" }, false)).toBe("Ctrl+S");
    expect(formatPaletteShortcut({ key: "," }, false)).toBe(",");
  });
});

const commands: PaletteCommand[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta tag" },
  { id: "c", label: "Gamma" },
  { id: "d", label: "Delta tag" },
];

describe("listPaletteCommands", () => {
  it("puts most recently used commands first on an empty query", () => {
    expect(
      listPaletteCommands(commands, "", ["d", "b"]).map((c) => c.id),
    ).toEqual(["d", "b", "a", "c"]);
  });

  it("caps the empty query list at RECENT_COMMANDS_LIMIT", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `c${i}`,
      label: `Cmd ${i}`,
    }));
    const recent = [...many].reverse().map((c) => c.id);
    expect(listPaletteCommands(many, "", recent).map((c) => c.id)).toEqual(
      recent.slice(0, RECENT_COMMANDS_LIMIT),
    );
  });

  it("skips unknown recent ids and fills with unused commands", () => {
    expect(
      listPaletteCommands(commands, "", ["gone", "c"]).map((c) => c.id),
    ).toEqual(["c", "a", "b", "d"]);
  });

  it("ranks search matches with recents first", () => {
    expect(
      listPaletteCommands(commands, "tag", ["d"]).map((c) => c.id),
    ).toEqual(["d", "b"]);
  });
});
