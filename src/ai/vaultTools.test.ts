import { describe, expect, it } from "vitest";
import type { TreeNode } from "../lib/vaultApi";
import { _test, buildSystemPrompt, buildVaultTools } from "./vaultTools";

function folder(
  name: string,
  path: string,
  children: TreeNode[] = [],
): TreeNode {
  return { name, path, isDir: true, children };
}

function file(name: string, path: string): TreeNode {
  return { name, path, isDir: false };
}

describe("vault agent tools", () => {
  it("exposes tags and folder listing in both modes; write path tools only in Agent", () => {
    const askTools = buildVaultTools("ask");
    const agentTools = buildVaultTools("agent");

    expect(askTools).toHaveProperty("list_tags");
    expect(askTools).toHaveProperty("list_folder");
    expect(askTools).not.toHaveProperty("move_path");
    expect(askTools).not.toHaveProperty("delete_path");
    expect(askTools).not.toHaveProperty("ensure_folder");
    expect(askTools).not.toHaveProperty("delete_folder_if_empty");
    expect(agentTools).toHaveProperty("list_tags");
    expect(agentTools).toHaveProperty("list_folder");
    expect(agentTools).toHaveProperty("move_path");
    expect(agentTools).toHaveProperty("delete_path");
    expect(agentTools).toHaveProperty("ensure_folder");
    expect(agentTools).toHaveProperty("delete_folder_if_empty");
  });

  it("tells the model when to use the new tools", () => {
    const base = {
      vaultPath: null,
      activePath: null,
      activeExcerpt: null,
    };

    const askPrompt = buildSystemPrompt({ ...base, mode: "ask" });
    expect(askPrompt).toContain("list_tags");
    expect(askPrompt).toContain("list_folder");
    expect(askPrompt).toContain(
      "In **chat replies**, reference vault notes with `[[vault/path/Note.md]]`",
    );

    const agentPrompt = buildSystemPrompt({ ...base, mode: "agent" });
    expect(agentPrompt).toContain("move_path");
    expect(agentPrompt).toContain("delete_path");
    expect(agentPrompt).toContain("list_folder");
    expect(agentPrompt).toContain("ensure_folder");
    expect(agentPrompt).toContain("delete_folder_if_empty");
  });

  it("lists folder contents with folder/file kinds and optional recursion", () => {
    const tree = folder("", "", [
      folder("Ideas", "Ideas", [
        file("A.md", "Ideas/A.md"),
        folder("Archive", "Ideas/Archive", [
          file("Old.md", "Ideas/Archive/Old.md"),
        ]),
      ]),
      file("Welcome.md", "Welcome.md"),
    ]);

    const root = _test.findFolderNode(tree, "");
    expect(root).toBe(tree);

    const ideas = _test.findFolderNode(tree, "Ideas");
    expect(ideas?.path).toBe("Ideas");

    expect(_test.findFolderNode(tree, "Missing")).toBeNull();
    expect(_test.findFolderNode(tree, "Welcome.md")).toBeNull();

    const shallow = _test.collectFolderEntries(ideas!, false);
    expect(shallow).toEqual([
      { path: "Ideas/A.md", name: "A.md", kind: "file" },
      { path: "Ideas/Archive", name: "Archive", kind: "folder" },
    ]);

    const deep = _test.collectFolderEntries(ideas!, true);
    expect(deep.map((e) => e.path)).toEqual([
      "Ideas/A.md",
      "Ideas/Archive",
      "Ideas/Archive/Old.md",
    ]);
    expect(deep.find((e) => e.path === "Ideas/Archive")?.kind).toBe("folder");
    expect(deep.find((e) => e.path === "Ideas/Archive/Old.md")?.kind).toBe(
      "file",
    );
  });
});
