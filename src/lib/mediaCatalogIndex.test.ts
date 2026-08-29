import { describe, expect, it } from "vitest";
import {
  collectFilmNotePathsUnder,
  filterMediaCatalogEntries,
  mediaCatalogEntryFromMarkdown,
  emptyMediaCatalogFilters,
} from "./mediaCatalogIndex";
import type { TreeNode } from "./vaultApi";

const tree: TreeNode = {
  name: "vault",
  path: "",
  isDir: true,
  children: [
    {
      name: "Медиатека",
      path: "Медиатека",
      isDir: true,
      children: [
        {
          name: "2026-Холод.md",
          path: "Медиатека/2026-Холод.md",
          isDir: false,
        },
        {
          name: "Sci-Fi",
          path: "Медиатека/Sci-Fi",
          isDir: true,
          children: [
            {
              name: "2010-Legion.md",
              path: "Медиатека/Sci-Fi/2010-Legion.md",
              isDir: false,
            },
          ],
        },
      ],
    },
  ],
};

describe("mediaCatalogIndex", () => {
  it("collects film notes recursively under a folder", () => {
    expect(collectFilmNotePathsUnder(tree, "Медиатека")).toEqual([
      "Медиатека/2026-Холод.md",
      "Медиатека/Sci-Fi/2010-Legion.md",
    ]);
    expect(collectFilmNotePathsUnder(tree, "Медиатека/Sci-Fi")).toEqual([
      "Медиатека/Sci-Fi/2010-Legion.md",
    ]);
  });

  it("parses entry fields from markdown", () => {
    const md = `---
title: Холод
original_title: Cold
kind: series
genres:
  - триллер
year: 2026
watched:
  - 2026-08-01
  - 2026-08-20
---
![|240](.assets/poster.jpg)

Что-то типа Ворошиловского стрелка
`;
    const e = mediaCatalogEntryFromMarkdown("Медиатека/2026-Холод.md", md);
    expect(e.title).toBe("Холод");
    expect(e.originalTitle).toBe("Cold");
    expect(e.kind).toBe("series");
    expect(e.genres).toEqual(["триллер"]);
    expect(e.year).toBe(2026);
    expect(e.watched).toEqual(["2026-08-01", "2026-08-20"]);
    expect(e.posterVaultPath).toBe("Медиатека/.assets/poster.jpg");
    expect(e.commentPreview).toContain("Ворошиловского");
  });

  it("filters by query and chips", () => {
    const entries = [
      mediaCatalogEntryFromMarkdown(
        "a.md",
        `---
title: Alpha
kind: film
genres:
  - Action
---
`,
      ),
      mediaCatalogEntryFromMarkdown(
        "b.md",
        `---
title: Beta
kind: series
genres:
  - Drama
---
Loved it
`,
      ),
    ];
    const filters = emptyMediaCatalogFilters();
    filters.query = "beta";
    expect(filterMediaCatalogEntries(entries, filters).map((e) => e.title)).toEqual([
      "Beta",
    ]);
    filters.query = "";
    filters.kind = "film";
    expect(filterMediaCatalogEntries(entries, filters).map((e) => e.title)).toEqual([
      "Alpha",
    ]);
  });
});
