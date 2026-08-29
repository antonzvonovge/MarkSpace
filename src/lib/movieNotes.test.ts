import { describe, expect, it } from "vitest";
import {
  buildFilmNoteMarkdown,
  collapseFilmNoteBodySections,
  filmNoteCommentPreview,
  filmNoteFileStem,
  leadingPosterUrl,
  normalizeImdbId,
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
      rating: 9,
      director: "Nolan",
      status: "favorite",
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
      year: 2008,
      rating: 8,
      director: "Someone",
      status: "watched",
      originalTitle: "Game of Thrones",
      imdbId: "tt0944947",
      kinopoiskId: 453406,
    });
    expect(getMovieAttrs(next)).toMatchObject({
      title: "Игра престолов",
      kind: "series",
      genres: ["Drama"],
      year: 2008,
      rating: 8,
      director: "Someone",
      status: "watched",
      originalTitle: "Game of Thrones",
      imdbId: "tt0944947",
      kinopoiskId: 453406,
    });
    expect(next).toContain("rewatch");
    const tagged = setNoteTags(next, ["rewatch", "mood"]);
    expect(getMovieAttrs(tagged).kind).toBe("series");
    expect(getMovieAttrs(tagged).genres).toEqual(["Drama"]);
  });

  it("clears empty movie fields and strips legacy tmdb keys", () => {
    const md = `---
kind: film
tmdb_id: 1
tmdb_media: movie
---

Body
`;
    const cleared = setMovieAttrs(md, {
      title: "",
      kind: "",
      year: null,
      status: "",
      genres: [],
      director: "",
      rating: null,
      originalTitle: "",
      imdbId: "",
      kinopoiskId: null,
    });
    expect(getMovieAttrs(cleared)).toMatchObject({
      title: "",
      kind: "",
      year: null,
      status: "",
      imdbId: "",
      originalTitle: "",
      kinopoiskId: null,
    });
    expect(cleared).not.toContain("tmdb_id");
    expect(cleared).not.toContain("tmdb_media");
  });
});
