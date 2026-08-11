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
    expect(askTools).not.toHaveProperty("clip_article");
    expect(askTools).not.toHaveProperty("translate_note");
    expect(askTools).not.toHaveProperty("open_or_create_daily_note");
    expect(askTools).toHaveProperty("scrape_url");
    expect(agentTools).toHaveProperty("list_tags");
    expect(agentTools).toHaveProperty("scrape_url");
    expect(agentTools).toHaveProperty("list_folder");
    expect(agentTools).toHaveProperty("move_path");
    expect(agentTools).toHaveProperty("delete_path");
    expect(agentTools).toHaveProperty("ensure_folder");
    expect(agentTools).toHaveProperty("delete_folder_if_empty");
    expect(agentTools).toHaveProperty("clip_article");
    expect(agentTools).toHaveProperty("translate_note");
    expect(agentTools).toHaveProperty("open_or_create_daily_note");
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
    expect(askPrompt).toContain("Folder notes:");
    expect(askPrompt).toContain(
      "In **chat replies**, reference vault notes with `[[vault/path/Note.md]]`",
    );
    expect(askPrompt).toMatch(/Web API keys configured: Tavily=(yes|no), Firecrawl=(yes|no)/);

    const agentPrompt = buildSystemPrompt({ ...base, mode: "agent" });
    expect(agentPrompt).toContain("move_path");
    expect(agentPrompt).toContain("delete_path");
    expect(agentPrompt).toContain("list_folder");
    expect(agentPrompt).toContain("ensure_folder");
    expect(agentPrompt).toContain("delete_folder_if_empty");
    expect(agentPrompt).toContain("clip_article");
    expect(agentPrompt).toContain("translate_note");
    expect(agentPrompt).toContain("scrape_url");
    expect(askPrompt).toContain("scrape_url");
    expect(askPrompt).not.toContain("translate_note");
  });

  it("reports configured web API keys without exposing secrets", async () => {
    const { useAiSettingsStore } = await import("../store/aiSettingsStore");
    const { DEFAULT_AI_SETTINGS } = await import("./types");
    const prev = useAiSettingsStore.getState().settings;
    useAiSettingsStore.setState({
      settings: {
        ...DEFAULT_AI_SETTINGS,
        tavilyApiKey: "tvly-test",
        firecrawlApiKey: "fc-test",
      },
      hydrated: true,
    });
    try {
      const prompt = buildSystemPrompt({
        mode: "ask",
        vaultPath: null,
        activePath: null,
        activeExcerpt: null,
      });
      expect(prompt).toContain(
        "Web API keys configured: Tavily=yes, Firecrawl=yes",
      );
      expect(prompt).not.toContain("tvly-test");
      expect(prompt).not.toContain("fc-test");
    } finally {
      useAiSettingsStore.setState({ settings: prev });
    }
  });

  it("mentions user-requested tools from @ chips", () => {
    const prompt = buildSystemPrompt({
      mode: "ask",
      vaultPath: null,
      activePath: null,
      activeExcerpt: null,
      forcedTools: ["web_search", "read_note"],
    });
    expect(prompt).toContain("@web_search");
    expect(prompt).toContain("@read_note");
    expect(prompt).toContain("Prefer calling them when relevant");
  });

  it("includes Active Gem instructions in the system prompt", () => {
    const prompt = buildSystemPrompt({
      mode: "ask",
      vaultPath: null,
      activePath: null,
      activeExcerpt: null,
      gemName: "Spanish tutor",
      gemInstructions: "Always correct grammar gently.",
    });
    expect(prompt).toContain("CRITICAL — Active Gem: Spanish tutor");
    expect(prompt).toContain("Gem instructions:");
    expect(prompt).toContain("Always correct grammar gently.");
    expect(prompt).toContain("OVERRIDE conflicting MarkSpace defaults");
    // Gem block appears before native-language / project boilerplate.
    expect(prompt.indexOf("CRITICAL — Active Gem")).toBeLessThan(
      prompt.indexOf("User's native language:"),
    );
  });

  it("omits Gem block when name or instructions are empty", () => {
    const noInstructions = buildSystemPrompt({
      mode: "ask",
      vaultPath: null,
      activePath: null,
      activeExcerpt: null,
      gemName: "X",
      gemInstructions: "  ",
    });
    expect(noInstructions).not.toContain("CRITICAL — Active Gem:");

    const noName = buildSystemPrompt({
      mode: "ask",
      vaultPath: null,
      activePath: null,
      activeExcerpt: null,
      gemName: "",
      gemInstructions: "Do something",
    });
    expect(noName).not.toContain("CRITICAL — Active Gem:");
  });

  it("documents project-scoped discovery tools in the system prompt", () => {
    const prompt = buildSystemPrompt({
      mode: "ask",
      vaultPath: null,
      activePath: null,
      activeExcerpt: null,
      projectPath: "MyProject",
    });
    expect(prompt).toContain("Active project: MyProject");
    expect(prompt).toContain("Project scope:");
    expect(prompt).toContain("list_notes");
    expect(prompt).toContain("semantic_search");
    expect(prompt).toContain("list_tags");
  });

  it("includes project type and learning language in the system prompt", () => {
    const prompt = buildSystemPrompt({
      mode: "ask",
      vaultPath: null,
      activePath: null,
      activeExcerpt: null,
      projectPath: "Spanish",
      projectType: "languageLearning",
      projectLearningLanguage: "es",
      projectAbout: "A1 vocab",
    });
    expect(prompt).toContain("Project type: Foreign language learning.");
    expect(prompt).toContain("Learning language: Spanish (es).");
    expect(prompt).toContain("A1 vocab");
  });

  it("includes diary guidance in the system prompt", () => {
    const prompt = buildSystemPrompt({
      mode: "ask",
      vaultPath: null,
      activePath: null,
      activeExcerpt: null,
      projectPath: "Journal",
      projectType: "diary",
      projectAbout: "Daily reflections",
    });
    expect(prompt).toContain("Project type: Diary.");
    expect(prompt).toContain("personal diary project");
    expect(prompt).toContain("Daily reflections");
    expect(prompt).toContain("{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md");
    expect(prompt).toContain("open_or_create_daily_note");
  });

  it("documents diary daily-note tool in agent mode system prompt", () => {
    const prompt = buildSystemPrompt({
      mode: "agent",
      vaultPath: null,
      activePath: null,
      activeExcerpt: null,
    });
    expect(prompt).toContain("open_or_create_daily_note");
    expect(prompt).toContain("{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md");
  });

  it("tells the model to address the user by name when Profile name is set", async () => {
    const { usePrefsStore } = await import("../store/prefsStore");
    const { DEFAULT_PREFS } = await import("../settings/types");
    const prev = usePrefsStore.getState().prefs;
    usePrefsStore.setState({
      prefs: { ...DEFAULT_PREFS, userName: "Alex" },
      hydrated: true,
    });
    try {
      const withName = buildSystemPrompt({
        mode: "ask",
        vaultPath: null,
        activePath: null,
        activeExcerpt: null,
      });
      expect(withName).toContain("The user's name is Alex.");
      expect(withName).toContain("Address them as Alex");
      expect(withName).toContain("warm, friendly tone");

      usePrefsStore.setState({
        prefs: { ...DEFAULT_PREFS, userName: "" },
        hydrated: true,
      });
      const withoutName = buildSystemPrompt({
        mode: "ask",
        vaultPath: null,
        activePath: null,
        activeExcerpt: null,
      });
      expect(withoutName).not.toContain("The user's name is");
      expect(withoutName).not.toContain("Address them as");
    } finally {
      usePrefsStore.setState({ prefs: prev });
    }
  });

  it("injects global and active-project memories into the system prompt", async () => {
    const { useAgentMemoryStore } = await import("../store/agentMemoryStore");
    const prev = useAgentMemoryStore.getState().doc;
    useAgentMemoryStore.setState({
      doc: {
        version: 1,
        enabled: true,
        entries: [
          {
            id: "m1",
            text: "Prefers concise Russian replies",
            projectPath: null,
            createdAt: "1",
            updatedAt: "1",
          },
          {
            id: "m2",
            text: "FluentMe posts for teachers",
            projectPath: "FluentMe",
            createdAt: "1",
            updatedAt: "1",
          },
          {
            id: "m3",
            text: "Other project fact",
            projectPath: "Other",
            createdAt: "1",
            updatedAt: "1",
          },
        ],
      },
      hydrated: true,
    });
    try {
      const withProject = buildSystemPrompt({
        mode: "ask",
        vaultPath: "/vault",
        activePath: null,
        activeExcerpt: null,
        projectPath: "FluentMe",
      });
      expect(withProject).toContain("Saved memories (global):");
      expect(withProject).toContain("[m1] Prefers concise Russian replies");
      expect(withProject).toContain("Saved memories (project FluentMe):");
      expect(withProject).toContain("[m2] FluentMe posts for teachers");
      expect(withProject).not.toContain("Other project fact");

      const noProject = buildSystemPrompt({
        mode: "ask",
        vaultPath: "/vault",
        activePath: null,
        activeExcerpt: null,
      });
      expect(noProject).toContain("[m1] Prefers concise Russian replies");
      expect(noProject).not.toContain("Saved memories (project");
      expect(noProject).not.toContain("FluentMe posts for teachers");

      useAgentMemoryStore.setState({
        doc: { ...useAgentMemoryStore.getState().doc, enabled: false },
      });
      const disabled = buildSystemPrompt({
        mode: "ask",
        vaultPath: "/vault",
        activePath: null,
        activeExcerpt: null,
        projectPath: "FluentMe",
      });
      expect(disabled).not.toContain("Saved memories");
    } finally {
      useAgentMemoryStore.setState({ doc: prev });
    }
  });

  it("exposes remember/forget/list_memories in ask and agent modes", () => {
    const ask = buildVaultTools("ask");
    const agent = buildVaultTools("agent");
    expect(ask).toHaveProperty("remember");
    expect(ask).toHaveProperty("forget");
    expect(ask).toHaveProperty("list_memories");
    expect(agent).toHaveProperty("remember");
    expect(agent).toHaveProperty("forget");
    expect(agent).toHaveProperty("list_memories");
  });

  it("matches paths inside the active project only", () => {
    const none = _test.makeInProject(null);
    expect(none("Anywhere/Note.md")).toBe(true);

    const inProject = _test.makeInProject("MyProject");
    expect(inProject("MyProject")).toBe(true);
    expect(inProject("MyProject/Note.md")).toBe(true);
    expect(inProject("MyProject/docs/A.md")).toBe(true);
    expect(inProject("Other/Note.md")).toBe(false);
    expect(inProject("MyProjectExtra/Note.md")).toBe(false);
    expect(inProject("Welcome.md")).toBe(false);
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
