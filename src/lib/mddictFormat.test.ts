import { describe, expect, it } from "vitest";
import {
  EMPTY_MDDICT,
  MDDICT_HEADER,
  collectMddictDocTags,
  collectMddictTags,
  filterMddictItems,
  mergeDictItem,
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
known: yes
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
      known: true,
    });
    expect(doc.items[1]!.known).toBe(false);
    const again = parseMddict(serializeMddict(doc));
    expect(again).toEqual(doc);
    expect(serializeMddict(doc)).toContain("known: yes");
    expect(serializeMddict(doc).match(/known:/g)).toHaveLength(1);
  });

  it("parses known truthy values", () => {
    for (const raw of ["yes", "true", "1", "YES"]) {
      const doc = parseMddict(`${MDDICT_HEADER}

word
known: ${raw}
`);
      expect(doc.items[0]!.known).toBe(true);
    }
    const no = parseMddict(`${MDDICT_HEADER}

word
known: no
`);
    expect(no.items[0]!.known).toBe(false);
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
        known: false,
      },
      {
        word: "Baum",
        transcript: "",
        translation: "",
        examples: [],
        tags: ["noun"],
        known: false,
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
          known: true,
        },
        {
          word: "ok",
          transcript: "",
          translation: "",
          examples: [],
          tags: [],
          known: false,
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
        known: false,
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
        known: false,
      },
      {
        word: "b",
        transcript: "",
        translation: "",
        examples: [],
        tags: ["verbs"],
        known: false,
      },
      {
        word: "c",
        transcript: "",
        translation: "",
        examples: [],
        tags: ["A1"],
        known: false,
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
          known: false,
        },
        {
          word: "b",
          transcript: "",
          translation: "",
          examples: [],
          tags: ["verbs", "noun"],
          known: false,
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
            known: false,
          },
        ],
      }),
    ).toEqual(["A1", "extra", "verbs"]);
  });

  it("rejects bad header", () => {
    expect(() => parseMddict("# wrong\n")).toThrow(/header/i);
  });

  it("appends or merges dictionary entries by word", () => {
    const empty = parseMddict(EMPTY_MDDICT);
    const added = mergeDictItem(empty, {
      word: "apple",
      transcript: "/ˈæp.əl/",
      translation: "яблоко",
      examples: ["I ate an apple."],
      tags: [],
      known: false,
    });
    expect(added.merged).toBe(false);
    expect(added.doc.items).toHaveLength(1);

    const updated = mergeDictItem(added.doc, {
      word: "Apple",
      transcript: "",
      translation: "яблочко",
      examples: ["Another."],
      tags: ["fruit"],
      known: true,
    });
    expect(updated.merged).toBe(true);
    expect(updated.doc.items).toHaveLength(1);
    expect(updated.doc.items[0]).toEqual({
      word: "Apple",
      transcript: "",
      translation: "яблочко",
      examples: ["Another."],
      tags: [],
      known: false,
    });
  });
});
