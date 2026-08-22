import { describe, expect, it } from "vitest";
import {
  bumpLexiconLemmaCreated,
  emptyLexiconReorgState,
  LEXICON_REORG_EVERY,
  markLexiconReorgStarted,
  projectsDueForLexiconReorg,
} from "./lexiconReorgState";

describe("lexiconReorgState", () => {
  it("does not mark due before the batch size", () => {
    let file = emptyLexiconReorgState();
    for (let i = 0; i < LEXICON_REORG_EVERY - 1; i++) {
      file = bumpLexiconLemmaCreated(file, "English");
    }
    expect(file.byProject.English?.newLemmas).toBe(LEXICON_REORG_EVERY - 1);
    expect(projectsDueForLexiconReorg(file)).toEqual([]);
  });

  it("marks due on the Nth new lemma and resets when a review starts", () => {
    let file = emptyLexiconReorgState();
    for (let i = 0; i < LEXICON_REORG_EVERY; i++) {
      file = bumpLexiconLemmaCreated(file, "English");
    }
    expect(projectsDueForLexiconReorg(file)).toEqual(["English"]);
    file = markLexiconReorgStarted(file, "English");
    expect(file.byProject.English).toEqual({ newLemmas: 0, reorgDue: false });
    expect(projectsDueForLexiconReorg(file)).toEqual([]);
  });
});
