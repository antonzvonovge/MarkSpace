import { describe, expect, it } from "vitest";
import { localizeMovieGenres } from "./movieGenreLocales";

describe("localizeMovieGenres", () => {
  it("maps OMDb English genres to Russian", () => {
    expect(
      localizeMovieGenres(["Action", "Sci-Fi", "Drama"], "ru"),
    ).toEqual(["боевик", "фантастика", "драма"]);
  });

  it("keeps English when native is en", () => {
    expect(
      localizeMovieGenres(["Action", "Sci-Fi", "Drama"], "en"),
    ).toEqual(["Action", "Sci-Fi", "Drama"]);
  });

  it("normalizes Kinopoisk Russian into the target locale", () => {
    expect(
      localizeMovieGenres(["боевик", "фантастика", "мелодрама"], "en"),
    ).toEqual(["Action", "Sci-Fi", "Romance"]);
  });

  it("maps to Ukrainian", () => {
    expect(localizeMovieGenres(["Thriller", "Horror"], "uk")).toEqual([
      "трилер",
      "жахи",
    ]);
  });

  it("leaves unknown genres as-is and dedupes", () => {
    expect(
      localizeMovieGenres(["Action", "боевик", "Weirdcore"], "ru"),
    ).toEqual(["боевик", "Weirdcore"]);
  });
});
