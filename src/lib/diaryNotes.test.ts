import { describe, expect, it } from "vitest";
import {
  collectDailyNoteDayKeys,
  dailyNoteFolderPaths,
  dailyNoteOpeningMarkdown,
  dailyNotePath,
  dayKey,
  diaryProjectRootForPath,
  formatDailyNoteHeading,
  formatDailyNoteStem,
  isoDateOnly,
  isUnderDiaryProject,
  parseDailyNoteDate,
  parseIsoDateOnly,
  preferredDiaryProjectRoot,
  resolveDiaryProjectRoot,
  vaultProjectRootOf,
} from "./diaryNotes";
import type { ProjectProperties, TreeNode } from "./vaultApi";

const diaryProps: Record<string, ProjectProperties> = {
  Journal: {
    path: "Journal",
    about: "",
    projectType: "diary",
    learningLanguage: "",
    color: "",
  },
  Work: {
    path: "Work",
    about: "",
    projectType: "knowledgeBase",
    learningLanguage: "",
    color: "",
  },
};

describe("vaultProjectRootOf", () => {
  it("returns first segment or null for root", () => {
    expect(vaultProjectRootOf("")).toBeNull();
    expect(vaultProjectRootOf("Journal")).toBe("Journal");
    expect(vaultProjectRootOf("Journal/2026/08")).toBe("Journal");
  });
});

describe("diaryProjectRootForPath", () => {
  it("detects diary project and descendants", () => {
    expect(diaryProjectRootForPath("Journal", diaryProps)).toBe("Journal");
    expect(diaryProjectRootForPath("Journal/2026/08/note.md", diaryProps)).toBe(
      "Journal",
    );
    expect(diaryProjectRootForPath("Work/a.md", diaryProps)).toBeNull();
    expect(diaryProjectRootForPath("", diaryProps)).toBeNull();
  });

  it("isUnderDiaryProject mirrors root lookup", () => {
    expect(isUnderDiaryProject("Journal/2026", diaryProps)).toBe(true);
    expect(isUnderDiaryProject("Work", diaryProps)).toBe(false);
  });
});

describe("daily note naming and layout", () => {
  it("formats dd.MMM.yyyy with English months", () => {
    expect(formatDailyNoteStem(new Date(2026, 7, 2))).toBe("02.Aug.2026");
    expect(formatDailyNoteStem(new Date(2026, 0, 9))).toBe("09.Jan.2026");
  });

  it("formats the in-note heading in the native language", () => {
    const aug15 = new Date(2026, 7, 15);
    expect(formatDailyNoteHeading(aug15, "ru")).toBe("15 Августа 2026");
    expect(formatDailyNoteHeading(aug15, "en")).toBe("15 August 2026");
    expect(formatDailyNoteHeading(aug15, "uk")).toBe("15 Серпня 2026");
    expect(formatDailyNoteHeading(new Date(2026, 0, 9), "ru")).toBe(
      "9 Января 2026",
    );
    expect(dailyNoteOpeningMarkdown(aug15, "ru")).toBe("# 15 Августа 2026\n\n");
  });

  it("parses YYYY-MM-DD local dates", () => {
    const d = parseIsoDateOnly("2026-08-02");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(2);
    expect(parseIsoDateOnly("02.Aug.2026")).toBeNull();
    expect(parseIsoDateOnly("2026-02-31")).toBeNull();
  });

  it("formats local YYYY-MM-DD", () => {
    expect(isoDateOnly(new Date(2026, 7, 2))).toBe("2026-08-02");
    expect(isoDateOnly(new Date(2026, 0, 9))).toBe("2026-01-09");
  });

  it("builds year/month path", () => {
    expect(dailyNotePath("Journal", new Date(2026, 7, 2))).toBe(
      "Journal/2026/08/02.Aug.2026.md",
    );
    expect(dailyNoteFolderPaths("Journal", new Date(2026, 7, 2))).toEqual([
      "Journal",
      "Journal/2026",
      "Journal/2026/08",
    ]);
  });

  it("parses daily note paths", () => {
    const parsed = parseDailyNoteDate("Journal/2026/08/02.Aug.2026.md");
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(7);
    expect(parsed!.getDate()).toBe(2);
    expect(parseDailyNoteDate("Journal/note.md")).toBeNull();
  });
});

describe("collectDailyNoteDayKeys", () => {
  it("collects daily note days under the diary project", () => {
    const tree: TreeNode = {
      name: "",
      path: "",
      isDir: true,
      children: [
        {
          name: "Journal",
          path: "Journal",
          isDir: true,
          children: [
            {
              name: "2026",
              path: "Journal/2026",
              isDir: true,
              children: [
                {
                  name: "08",
                  path: "Journal/2026/08",
                  isDir: true,
                  children: [
                    {
                      name: "02.Aug.2026.md",
                      path: "Journal/2026/08/02.Aug.2026.md",
                      isDir: false,
                    },
                    {
                      name: "readme.md",
                      path: "Journal/2026/08/readme.md",
                      isDir: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          name: "Work",
          path: "Work",
          isDir: true,
          children: [
            {
              name: "note.md",
              path: "Work/note.md",
              isDir: false,
            },
          ],
        },
      ],
    };
    const keys = collectDailyNoteDayKeys(tree, "Journal");
    expect(keys.has(dayKey(new Date(2026, 7, 2)))).toBe(true);
    expect(keys.size).toBe(1);
  });
});

describe("resolveDiaryProjectRoot", () => {
  it("prefers selected folder, then sole diary project", () => {
    expect(
      resolveDiaryProjectRoot({
        selectedFolderPath: "Journal/2026",
        activePath: null,
        chatProjectPath: null,
        projectPropertiesByPath: diaryProps,
      }),
    ).toBe("Journal");

    expect(
      resolveDiaryProjectRoot({
        selectedFolderPath: "",
        activePath: null,
        chatProjectPath: null,
        projectPropertiesByPath: diaryProps,
      }),
    ).toBe("Journal");

    const twoDiaries = {
      ...diaryProps,
      Diary2: {
        path: "Diary2",
        about: "",
        projectType: "diary" as const,
        learningLanguage: "",
        color: "",
      },
    };
    expect(
      resolveDiaryProjectRoot({
        selectedFolderPath: "",
        activePath: null,
        chatProjectPath: null,
        projectPropertiesByPath: twoDiaries,
      }),
    ).toBeNull();
  });
});

describe("preferredDiaryProjectRoot", () => {
  it("falls back to the first diary when several exist", () => {
    const twoDiaries = {
      ...diaryProps,
      Diary2: {
        path: "Diary2",
        about: "",
        projectType: "diary" as const,
        learningLanguage: "",
        color: "",
      },
    };
    expect(
      preferredDiaryProjectRoot({
        selectedFolderPath: "",
        activePath: null,
        chatProjectPath: null,
        projectPropertiesByPath: twoDiaries,
      }),
    ).toBe("Diary2");
  });
});
