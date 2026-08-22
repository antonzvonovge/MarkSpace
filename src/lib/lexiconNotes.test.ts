import { describe, expect, it } from "vitest";
import {
  assembleLexiconBody,
  buildLexiconMarkdown,
  LEXICON_MAX_MD_SEGMENTS,
  formatLexiconFolderLoad,
  isVaultLexiconFolder,
  isVaultLexiconMdNote,
  lexiconSlug,
  pickLexiconProject,
  resolveLexiconMovePath,
  splitLexiconBody,
  validateLexiconMove,
} from "./lexiconNotes";
import { filterLexiconMoves, parseLexiconMoves } from "../ai/lexiconReorg";
import type { QuickTranslateResult } from "../ai/quickTranslate";
import type { ProjectProperties } from "./vaultApi";

const word: QuickTranslateResult = {
  query: "went",
  queryLang: "en",
  lemma: "go",
  transcript: "",
  translation: "идти",
  translationTranscript: "",
  didYouMean: "",
  forms: ["goes", "went", "gone"],
  synonyms: [],
  senses: [{ pos: "verb", meaning: "двигаться", register: "", usage: "", collocations: [] }],
  examples: [],
};

describe("lexiconNotes", () => {
  it("splits and preserves Notes tail", () => {
    const { generated, notes, hasExtraNotes } = splitLexiconBody(
      "# go\n\nидти\n\n## Notes\n\nMy example.\n",
    );
    expect(generated).toContain("идти");
    expect(hasExtraNotes).toBe(true);
    expect(notes.trim()).toBe("My example.");
    const next = assembleLexiconBody("new body", notes);
    expect(next).toContain("new body");
    expect(next).toContain("My example.");
  });

  it("does not flag empty Notes", () => {
    expect(splitLexiconBody("# go\n\n## Notes\n").hasExtraNotes).toBe(false);
  });

  it("rebuilds markdown without wiping notes", () => {
    const existing = buildLexiconMarkdown(null, word, "en");
    const withNotes = existing.replace("## Notes\n", "## Notes\n\nKeep me\n");
    const next = buildLexiconMarkdown(
      withNotes,
      word,
      "en",
      "# go\n\nFull article here.",
    );
    expect(next).toContain("Keep me");
    expect(next).toContain("lemma: go");
    expect(next).toContain("Full article here.");
    expect(next).toContain("went");
  });

  it("picks the active language-learning project", () => {
    const projects: Record<string, ProjectProperties> = {
      A: {
        path: "A",
        about: "",
        projectType: "languageLearning",
        learningLanguage: "en",
        color: "",
      },
      B: {
        path: "B",
        about: "",
        projectType: "languageLearning",
        learningLanguage: "en",
        color: "",
      },
      Ka: {
        path: "Ka",
        about: "",
        projectType: "languageLearning",
        learningLanguage: "ka",
        color: "",
      },
    };
    expect(pickLexiconProject(projects, "en", "B/notes/x.md")).toBe("B");
    expect(pickLexiconProject(projects, "ka", "B/notes/x.md")).toBe("Ka");
    expect(pickLexiconProject(projects, "de")).toBeNull();
  });

  it("recognizes the project Lexicon folder", () => {
    expect(isVaultLexiconFolder("Georgian/Lexicon", true)).toBe(true);
    expect(isVaultLexiconFolder("Georgian/lexicon", true)).toBe(true);
    expect(isVaultLexiconFolder("Georgian/Lexicon/verbs", true)).toBe(false);
    expect(isVaultLexiconFolder("Lexicon", true)).toBe(false);
    expect(isVaultLexiconFolder("Georgian/Lexicon/go.md", false)).toBe(false);
    expect(isVaultLexiconMdNote("English/Lexicon/boost.md")).toBe(true);
    expect(isVaultLexiconMdNote("English/Lexicon/verbs/go.md")).toBe(true);
    expect(isVaultLexiconMdNote("English/Lexicon/.folder.md")).toBe(false);
    expect(isVaultLexiconMdNote("English/notes/go.md")).toBe(false);
  });

  it("summarizes folder load", () => {
    const tree = {
      name: "vault",
      path: "",
      isDir: true,
      children: [
        {
          name: "En",
          path: "En",
          isDir: true,
          children: [
            {
              name: "Lexicon",
              path: "En/Lexicon",
              isDir: true,
              children: [
                {
                  name: "go.md",
                  path: "En/Lexicon/go.md",
                  isDir: false,
                },
                {
                  name: "verbs",
                  path: "En/Lexicon/verbs",
                  isDir: true,
                  children: [
                    {
                      name: "see.md",
                      path: "En/Lexicon/verbs/see.md",
                      isDir: false,
                    },
                    {
                      name: "eat.md",
                      path: "En/Lexicon/verbs/eat.md",
                      isDir: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(formatLexiconFolderLoad(tree, "En")).toBe(
      "verbs: 2\n(Lexicon root): 1",
    );
  });

  it("slugs lemmas", () => {
    expect(lexiconSlug("go / went")).toBe("go - went");
    expect(lexiconSlug("a/b")).toBe("a-b");
  });
});

describe("lexicon moves", () => {
  const project = "En";
  const occupied = new Set(["En/Lexicon/go.md"]);

  it("rejects path traversal and extra depth", () => {
    expect(
      validateLexiconMove(
        { from: "En/Lexicon/go.md", to: "En/Lexicon/../secret.md" },
        project,
        occupied,
      ),
    ).toBe("Invalid path");
    const deep = "En/Lexicon/a/b/c/go.md";
    expect(deep.split("/").length - 2).toBeGreaterThan(LEXICON_MAX_MD_SEGMENTS);
    expect(
      validateLexiconMove(
        { from: "En/Lexicon/go.md", to: deep },
        project,
        occupied,
      ),
    ).toBe("Lexicon folder depth exceeded");
    expect(
      validateLexiconMove(
        { from: "En/Lexicon/go.md", to: "Other/Lexicon/go.md" },
        project,
        occupied,
      ),
    ).toBe("Move must stay inside Lexicon");
  });

  it("resolves paths relative to Lexicon", () => {
    expect(resolveLexiconMovePath("verbs/go.md", "En")).toBe(
      "En/Lexicon/verbs/go.md",
    );
    expect(resolveLexiconMovePath("Lexicon/go.md", "En")).toBe("En/Lexicon/go.md");
  });

  it("accepts two folder levels", () => {
    expect(
      validateLexiconMove(
        { from: "En/Lexicon/go.md", to: "En/Lexicon/verbs/motion/go.md" },
        project,
        occupied,
      ),
    ).toBeNull();
  });

  it("parses moves and drops no-ops", () => {
    const moves = parseLexiconMoves(
      `{"moves":[{"from":"En/Lexicon/go.md","to":"En/Lexicon/go.md"},{"from":"En/Lexicon/go.md","to":"En/Lexicon/verbs/go.md"}]}`,
    );
    const { accepted, warnings } = filterLexiconMoves(
      moves,
      project,
      occupied,
    );
    expect(warnings).toEqual([]);
    expect(accepted).toEqual([
      { from: "En/Lexicon/go.md", to: "En/Lexicon/verbs/go.md" },
    ]);
  });
});
