import { describe, expect, it } from "vitest";
import {
  buildFilmNoteMarkdown,
  bodyWithoutLeadingPoster,
  collapseFilmNoteBodySections,
  filmNoteCommentPreview,
  filmNoteFileStem,
  formatMovieWatchedSummary,
  genreShelfFolderName,
  leadingPosterUrl,
  normalizeImdbId,
  resolveFilmShelfFolder,
  sanitizeFilmNoteName,
  withLeadingPoster,
} from "./movieNotes";
import { getMovieAttrs, setMovieAttrs, setNoteTags } from "./noteFrontmatter";

describe("movieNotes", () => {
  it("sanitizes film note names", () => {
    expect(sanitizeFilmNoteName("Inception")).toBe("Inception");
    expect(sanitizeFilmNoteName('Foo: Bar/Baz?')).toBe("Foo BarBaz");
    expect(sanitizeFilmNoteName("   ")).toBe("Untitled film");
  });

  it("capitalizes genre shelf folder names", () => {
    expect(genreShelfFolderName("ужасы")).toBe("Ужасы");
    expect(genreShelfFolderName("Sci-Fi")).toBe("Sci-Fi");
    expect(genreShelfFolderName("  a/b  ")).toBe("A b");
  });

  it("resolves film shelf folder preferring existing genre match", () => {
    expect(
      resolveFilmShelfFolder({
        projectRoot: "Медиатека",
        genres: ["боевик", "фэнтези", "ужасы"],
        existingChildFolders: ["Ужасы", "Драма"],
      }),
    ).toBe("Медиатека/Ужасы");
    expect(
      resolveFilmShelfFolder({
        projectRoot: "Медиатека",
        genres: ["комедия"],
        existingChildFolders: ["Ужасы"],
      }),
    ).toBe("Медиатека/Комедия");
    expect(
      resolveFilmShelfFolder({
        projectRoot: "Медиатека",
        genres: [],
        existingChildFolders: ["Ужасы"],
      }),
    ).toBe("Медиатека");
  });

  it("strips leading poster from body", () => {
    const body = "![|240](.assets/p.jpg)\n\nMy notes\n";
    expect(bodyWithoutLeadingPoster(body)).toBe("My notes\n");
    expect(bodyWithoutLeadingPoster("just notes")).toBe("just notes");
  });

  it("builds year-title file stems preferring native title", () => {
    expect(
      filmNoteFileStem({
        title: "Начало",
        originalTitle: "Inception",
        year: 2010,
      }),
    ).toBe("2010-Начало");
    expect(
      filmNoteFileStem({
        title: "",
        originalTitle: "Inception",
        year: 2010,
      }),
    ).toBe("2010-Inception");
    expect(
      filmNoteFileStem({
        title: "Холод",
        originalTitle: "",
        year: null,
      }),
    ).toBe("Холод");
  });

  it("normalizes imdb ids", () => {
    expect(normalizeImdbId("tt1375666")).toBe("tt1375666");
    expect(normalizeImdbId("1375666")).toBe("tt1375666");
    expect(normalizeImdbId("bogus")).toBe("");
  });

  it("inserts and replaces leading poster", () => {
    const body = "My take.\n";
    const withPoster = withLeadingPoster(body, ".assets/poster.jpg");
    expect(leadingPosterUrl(withPoster)).toBe(".assets/poster.jpg");
    expect(withPoster).toContain("My take.");
    const replaced = withLeadingPoster(withPoster, ".assets/poster.png");
    expect(leadingPosterUrl(replaced)).toBe(".assets/poster.png");
  });

  it("collapses legacy Why I liked it / Notes headings", () => {
    const body = `![|240](.assets/p.jpg)

## Why I liked it

Great film

## Notes

Rewatch someday
`;
    const next = collapseFilmNoteBodySections(body);
    expect(next).not.toMatch(/Why I liked it|## Notes/);
    expect(next).toContain("Great film");
    expect(next).toContain("Rewatch someday");
    expect(leadingPosterUrl(next)).toBe(".assets/p.jpg");
    expect(filmNoteCommentPreview(next)).toBe("Great film\nRewatch someday");
  });

  it("builds film markdown with attrs", () => {
    const md = buildFilmNoteMarkdown({
      title: "Начало",
      kind: "film",
      genres: ["Sci-Fi"],
      year: 2010,
      rating: "legend",
      director: "Nolan",
      imdbId: "tt1375666",
      kinopoiskId: 447301,
      originalTitle: "Inception",
      posterAssetUrl: ".assets/poster.jpg",
    });
    expect(md).toContain("title: Начало");
    expect(md).toContain("kind: film");
    expect(md).toContain("imdb_id: tt1375666");
    expect(md).toContain("kinopoisk_id: 447301");
    expect(md).toContain("original_title: Inception");
    expect(md).toContain("poster: .assets/poster.jpg");
    expect(md).toContain("![|240](.assets/poster.jpg)");
    expect(md).not.toMatch(/Why I liked it|## Notes/);
  });
});

describe("movie frontmatter attrs", () => {
  it("reads and writes movie attrs while preserving tags", () => {
    const base = `---
tags:
  - rewatch
---

Body
`;
    const next = setMovieAttrs(base, {
      title: "Игра престолов",
      kind: "series",
      genres: ["Drama"],
      countries: ["США", "Великобритания"],
      year: 2008,
      rating: "quality",
      director: "Someone",
      originalTitle: "Game of Thrones",
      imdbId: "tt0944947",
      kinopoiskId: 453406,
      poster: ".assets/poster.jpg",
      watched: ["2026-01-05", "2024-03-12", "2026-01-05"],
    });
    expect(getMovieAttrs(next)).toMatchObject({
      title: "Игра престолов",
      kind: "series",
      genres: ["Drama"],
      countries: ["США", "Великобритания"],
      year: 2008,
      rating: "quality",
      director: "Someone",
      originalTitle: "Game of Thrones",
      imdbId: "tt0944947",
      kinopoiskId: 453406,
      poster: ".assets/poster.jpg",
      watched: ["2024-03-12", "2026-01-05", "2026-01-05"],
    });
    expect(next).toContain("rewatch");
    expect(next).toMatch(/watched:\n\s+- 2024-03-12/);
    const tagged = setNoteTags(next, ["rewatch", "mood"]);
    expect(getMovieAttrs(tagged).kind).toBe("series");
    expect(getMovieAttrs(tagged).genres).toEqual(["Drama"]);
  });

  it("clears empty movie fields and strips legacy tmdb keys", () => {
    const md = `---
kind: film
tmdb_id: 1
tmdb_media: movie
watched:
  - 2020-01-01
---

Body
`;
    const cleared = setMovieAttrs(md, {
      title: "",
      kind: "",
      year: null,
      genres: [],
      countries: [],
      director: "",
      rating: "",
      originalTitle: "",
      imdbId: "",
      kinopoiskId: null,
      poster: "",
      watched: [],
    });
    expect(getMovieAttrs(cleared)).toMatchObject({
      title: "",
      kind: "",
      year: null,
      imdbId: "",
      originalTitle: "",
      rating: "",
      kinopoiskId: null,
      poster: "",
      countries: [],
      watched: [],
    });
    expect(cleared).not.toContain("tmdb_id");
    expect(cleared).not.toContain("tmdb_media");
    expect(cleared).not.toContain("status:");
    expect(cleared).not.toContain("watched:");
  });
});

describe("movie watched helpers", () => {
  it("formats watch count and last day", () => {
    expect(formatMovieWatchedSummary([])).toBeNull();
    expect(formatMovieWatchedSummary(["2024-03-12"])).toBe(
      "1× · last Mar 12, 2024",
    );
    expect(
      formatMovieWatchedSummary(["2026-01-05", "2024-03-12", "2026-01-05"]),
    ).toBe("3× · last Jan 5, 2026");
  });
});
