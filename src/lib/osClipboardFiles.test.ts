import { describe, expect, it } from "vitest";
import {
  basenameFromOsPath,
  collectVaultDocumentFiles,
  conflictingImportNames,
  importEntryNames,
  isVaultDocumentName,
  pathsFromClipboardData,
} from "./osClipboardFiles";

function mockDataTransfer(init: {
  types?: string[];
  data?: Record<string, string>;
  files?: File[];
}): DataTransfer {
  const data = init.data ?? {};
  const files = init.files ?? [];
  const items = files.map((file) => ({
    kind: "file" as const,
    type: file.type,
    getAsFile: () => file,
  }));
  return {
    types: init.types ?? Object.keys(data),
    getData: (type: string) => data[type] ?? "",
    files: files as unknown as FileList,
    items: Object.assign(items, { length: items.length }) as unknown as DataTransferItemList,
  } as unknown as DataTransfer;
}

describe("osClipboardFiles", () => {
  it("parses file:// uri-list paths", () => {
    const dt = mockDataTransfer({
      types: ["text/uri-list"],
      data: {
        "text/uri-list":
          "file:///home/user/Notes/Welcome.md\n#comment\nfile:///home/user/x.drawio\n",
      },
    });
    expect(pathsFromClipboardData(dt)).toEqual([
      "/home/user/Notes/Welcome.md",
      "/home/user/x.drawio",
    ]);
  });

  it("parses Windows file URLs", () => {
    const dt = mockDataTransfer({
      data: {
        "text/uri-list": "file:///C:/Users/me/note.md",
      },
    });
    expect(pathsFromClipboardData(dt)).toEqual(["C:/Users/me/note.md"]);
  });

  it("collects only vault document files", () => {
    expect(isVaultDocumentName("a.md")).toBe(true);
    expect(isVaultDocumentName("a.drawio")).toBe(true);
    expect(isVaultDocumentName("a.mdlnks")).toBe(true);
    expect(isVaultDocumentName("vocab.mddict")).toBe(true);
    expect(isVaultDocumentName("year.mdhabit")).toBe(true);
    expect(isVaultDocumentName("a.png")).toBe(false);
    expect(isVaultDocumentName("notes.txt")).toBe(false);
    const dt = mockDataTransfer({
      types: ["Files"],
      files: [
        new File(["hi"], "note.md", { type: "text/markdown" }),
        new File(["x"], "pic.png", { type: "image/png" }),
      ],
    });
    expect(collectVaultDocumentFiles(dt).map((f) => f.name)).toEqual(["note.md"]);
  });

  it("derives basenames and import conflicts", () => {
    expect(basenameFromOsPath("/home/user/Notes/Welcome.md")).toBe("Welcome.md");
    expect(basenameFromOsPath("C:\\Users\\me\\note.md")).toBe("note.md");
    expect(importEntryNames(["/tmp/a.md", "/tmp/b.drawio"], [])).toEqual([
      "a.md",
      "b.drawio",
    ]);
    expect(
      conflictingImportNames("Project", ["a.md", "new.md"], (p) => p === "Project/a.md"),
    ).toEqual(["a.md"]);
    expect(
      conflictingImportNames("", ["Root.md"], (p) => p === "Root.md"),
    ).toEqual(["Root.md"]);
  });
});
