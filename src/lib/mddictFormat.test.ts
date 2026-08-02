import { describe, expect, it } from "vitest";
import {
  EMPTY_MDDICT,
  MDDICT_HEADER,
  collectMddictDocTags,
  collectMddictTags,
  filterMddictItems,
  parseMddict,
  serializeMddict,
} from "./mddictFormat";

describe("mddictFormat", () => {
  it("parses empty document", () => {
    const doc = parseMddict(EMPTY_MDDICT);
    expect(doc).toEqual({ filter: [], items: [] });
  });

  it("round-trips filter and items", () => {
    const src = `${MDDICT_HEADER}
filter: verbs, A1

sprechen
transcript: ˈʃpʁɛçn̩
translation: to speak
example: Kannst du Deutsch sprechen?
example: Wir sprechen über das Wetter.
tags: verbs, A1

Haus
transcript: haʊs
translation: house
example: Das Haus ist groß.
`;
    const doc = parseMddict(src);
    expect(doc.filter).toEqual(["verbs", "A1"]);
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0]).toEqual({
      word: "sprechen",
      transcript: "ˈʃpʁɛçn̩",
      translation: "to speak",
      examples: [
        "Kannst du Deutsch sprechen?",
        "Wir sprechen über das Wetter.",
      ],
      tags: ["verbs", "A1"],
    });
    const again = parseMddict(serializeMddict(doc));
    expect(again).toEqual(doc);
  });

  it("allows items with only a word", () => {
    const doc = parseMddict(`${MDDICT_HEADER}

Haus

Baum
tags: noun
`);
    expect(doc.items).toEqual([
      {
        word: "Haus",
        transcript: "",
        translation: "",
        examples: [],
        tags: [],
      },
      {
        word: "Baum",
        transcript: "",
        translation: "",
        examples: [],
        tags: ["noun"],
      },
    ]);
  });

  it("skips empty-word items on serialize", () => {
    const text = serializeMddict({
      filter: [],
      items: [
        {
          word: "",
          transcript: "x",
          translation: "y",
          examples: ["z"],
          tags: [],
        },
        {
          word: "ok",
          transcript: "",
          translation: "",
          examples: [],
          tags: [],
        },
      ],
    });
    expect(parseMddict(text).items).toEqual([
      {
        word: "ok",
        transcript: "",
        translation: "",
        examples: [],
        tags: [],
      },
    ]);
  });

  it("filters with AND semantics", () => {
    const items = [
      {
        word: "a",
        transcript: "",
        translation: "",
        examples: [],
        tags: ["verbs", "A1"],
      },
      {
        word: "b",
        transcript: "",
        translation: "",
        examples: [],
        tags: ["verbs"],
      },
      {
        word: "c",
        transcript: "",
        translation: "",
        examples: [],
        tags: ["A1"],
      },
    ];
    expect(filterMddictItems(items, []).map((i) => i.word)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(filterMddictItems(items, ["verbs"]).map((i) => i.word)).toEqual([
      "a",
      "b",
    ]);
    expect(
      filterMddictItems(items, ["verbs", "A1"]).map((i) => i.word),
    ).toEqual(["a"]);
  });

  it("collects unique tags from items and doc", () => {
    expect(
      collectMddictTags([
        {
          word: "a",
          transcript: "",
          translation: "",
          examples: [],
          tags: ["Verbs", "A1"],
        },
        {
          word: "b",
          transcript: "",
          translation: "",
          examples: [],
          tags: ["verbs", "noun"],
        },
      ]),
    ).toEqual(["Verbs", "A1", "noun"]);

    expect(
      collectMddictDocTags({
        filter: ["A1", "extra"],
        items: [
          {
            word: "a",
            transcript: "",
            translation: "",
            examples: [],
            tags: ["a1", "verbs"],
          },
        ],
      }),
    ).toEqual(["A1", "extra", "verbs"]);
  });

  it("rejects bad header", () => {
    expect(() => parseMddict("# wrong\n")).toThrow(/header/i);
  });
});
