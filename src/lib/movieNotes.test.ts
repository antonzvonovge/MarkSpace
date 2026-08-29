import { describe, expect, it } from "vitest";
import {
  buildFilmNoteMarkdown,
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

  it("normalizes imdb ids", () => {
    expect(normalizeImdbId("tt1375666")).toBe("tt1375666");
    expect(normalizeImdbId("1375666")).toBe("tt1375666");
    expect(normalizeImdbId("bogus")).toBe("");
  });

  it("inserts and replaces leading poster", () => {
    const body = "## Why I liked it\n\n";
    const withPoster = withLeadingPoster(body, ".assets/poster.jpg");
    expect(leadingPosterUrl(withPoster)).toBe(".assets/poster.jpg");
    expect(withPoster).toContain("## Why I liked it");
    const replaced = withLeadingPoster(withPoster, ".assets/poster.png");
    expect(leadingPosterUrl(replaced)).toBe(".assets/poster.png");
  });

  it("builds film markdown with attrs", () => {
    const md = buildFilmNoteMarkdown({
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
    expect(md).toContain("kind: film");
    expect(md).toContain("imdb_id: tt1375666");
    expect(md).toContain("kinopoisk_id: 447301");
    expect(md).toContain("original_title: Inception");
    expect(md).toContain("![|240](.assets/poster.jpg)");
    expect(md).toContain("## Why I liked it");
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
