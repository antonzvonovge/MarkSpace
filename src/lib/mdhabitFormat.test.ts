import { describe, expect, it } from "vitest";
import {
  MDHABIT_HEADER,
  applyDayAnswers,
  checkedCountOnDay,
  dayAnswerCounts,
  dayIsLogged,
  emptyMdhabit,
  findHabitIndex,
  habitAnswerOnDay,
  habitDayPaint,
  habitRatioColor,
  localIsoDate,
  normalizeIsoDate,
  parseMdhabit,
  serializeMdhabit,
  setHabitDay,
} from "./mdhabitFormat";

describe("mdhabitFormat", () => {
  it("parses empty document", () => {
    const src = emptyMdhabit(2026, "2026-08-15");
    const doc = parseMdhabit(src);
    expect(doc).toEqual({
      year: 2026,
      created: "2026-08-15",
      habits: [],
    });
  });

  it("round-trips yes and no dates compactly", () => {
    const src = `${MDHABIT_HEADER}
year: 2026
created: 2026-08-15

Water
question: Did you drink 2L of water?
color: #2196f3
dates: 2026-08-15 2026-08-16
no: 2026-08-17

Exercise
question: Did you work out?
color: #4caf50
dates: 2026-08-15
`;
    const doc = parseMdhabit(src);
    expect(doc.year).toBe(2026);
    expect(doc.created).toBe("2026-08-15");
    expect(doc.habits).toHaveLength(2);
    expect(doc.habits[0]).toEqual({
      name: "Water",
      question: "Did you drink 2L of water?",
      color: "#2196f3",
      dates: ["2026-08-15", "2026-08-16"],
      no: ["2026-08-17"],
    });
    expect(doc.habits[1]!.color).toBe("#4caf50");
    const text = serializeMdhabit(doc);
    expect(text).toContain("dates: 2026-08-15 2026-08-16");
    expect(text).toContain("no: 2026-08-17");
    expect(text).not.toContain("logged:");
    expect(parseMdhabit(text)).toEqual(doc);
  });

  it("reads legacy one-date-per-line entries and logged-as-no", () => {
    const doc = parseMdhabit(`${MDHABIT_HEADER}
year: 2026
created: 2026-08-15
logged: 2026-08-15 2026-08-16

Water
question: Drink?
2026-08-15
`);
    expect(doc.habits[0]!.dates).toEqual(["2026-08-15"]);
    expect(doc.habits[0]!.no).toEqual(["2026-08-16"]);
    expect(serializeMdhabit(doc)).toMatch(/dates: 2026-08-15/);
    expect(serializeMdhabit(doc)).toMatch(/no: 2026-08-16/);
  });

  it("drops unknown colors and sorts unique dates", () => {
    const doc = parseMdhabit(`${MDHABIT_HEADER}
year: 2026
created: 2026-01-01

Water
question: Drink?
color: #not-a-color
2026-01-03
2026-01-01
2026-01-01
`);
    expect(doc.habits[0]!.color).toBe("");
    expect(doc.habits[0]!.dates).toEqual(["2026-01-01", "2026-01-03"]);
    expect(doc.habits[0]!.no).toEqual([]);
  });

  it("rejects bad header, missing year, and duplicate names", () => {
    expect(() => parseMdhabit("# wrong\n")).toThrow(/header/i);
    expect(() =>
      parseMdhabit(`${MDHABIT_HEADER}\ncreated: 2026-01-01\n`),
    ).toThrow(/year/i);
    expect(() =>
      parseMdhabit(`${MDHABIT_HEADER}
year: 2026
created: 2026-01-01

Water
question: A

water
question: B
`),
    ).toThrow(/duplicate/i);
  });

  it("normalizes calendar dates", () => {
    expect(normalizeIsoDate("2026-08-15")).toBe("2026-08-15");
    expect(normalizeIsoDate("2026-02-29")).toBeNull();
    expect(normalizeIsoDate("2028-02-29")).toBe("2028-02-29");
    expect(localIsoDate(new Date(2026, 7, 15))).toBe("2026-08-15");
  });

  it("finds habits and sets explicit yes/no", () => {
    const habits = [
      {
        name: "Water",
        question: "Q",
        color: "",
        dates: ["2026-08-15"],
        no: [],
      },
    ];
    expect(findHabitIndex(habits, "water")).toBe(0);
    expect(setHabitDay(habits, "Water", "2026-08-16", true)[0]!.dates).toEqual([
      "2026-08-15",
      "2026-08-16",
    ]);
    const missed = setHabitDay(habits, "Water", "2026-08-15", false)[0]!;
    expect(missed.dates).toEqual([]);
    expect(missed.no).toEqual(["2026-08-15"]);
    expect(habitAnswerOnDay(habits[0]!, "2026-08-15")).toBe("yes");
    expect(habitAnswerOnDay(missed, "2026-08-15")).toBe("no");
    expect(checkedCountOnDay(habits, "2026-08-15")).toBe(1);
    expect(checkedCountOnDay(habits, "2026-08-16")).toBe(0);
  });

  it("applies yes/no without turning skip into no", () => {
    const habits = [
      { name: "Water", question: "Q", color: "", dates: ["2026-08-15"], no: [] },
      { name: "Exercise", question: "Q", color: "", dates: [], no: [] },
    ];
    const next = applyDayAnswers(habits, "2026-08-15", ["Exercise"], ["Water"]);
    expect(habitAnswerOnDay(next[0]!, "2026-08-15")).toBe("no");
    expect(habitAnswerOnDay(next[1]!, "2026-08-15")).toBe("yes");
    const skipped = applyDayAnswers(habits, "2026-08-16", ["Water"], []);
    expect(habitAnswerOnDay(skipped[0]!, "2026-08-16")).toBe("yes");
    expect(habitAnswerOnDay(skipped[1]!, "2026-08-16")).toBe("none");
  });

  it("paints only explicit answers; skip stays empty", () => {
    expect(habitDayPaint("2026-01-01", "2026-08-15", "2026-08-15", 0, 0)).toBe(
      "gray",
    );
    expect(habitDayPaint("2026-08-20", "2026-08-15", "2026-08-15", 0, 0)).toBe(
      "none",
    );
    expect(habitDayPaint("2026-08-14", "2026-08-01", "2026-08-15", 0, 0)).toBe(
      "none",
    );
    expect(habitDayPaint("2026-08-14", "2026-08-01", "2026-08-15", 0, 2)).toBe(
      "ratio",
    );
    expect(habitDayPaint("2026-08-15", "2026-08-15", "2026-08-15", 0, 0)).toBe(
      "none",
    );
    expect(habitDayPaint("2026-08-15", "2026-08-15", "2026-08-15", 0, 2)).toBe(
      "ratio",
    );
    expect(dayAnswerCounts(
      [
        { name: "A", question: "Q", color: "", dates: ["2026-08-15"], no: [] },
        { name: "B", question: "Q", color: "", dates: [], no: ["2026-08-15"] },
        { name: "C", question: "Q", color: "", dates: [], no: [] },
      ],
      "2026-08-15",
    )).toEqual({ done: 1, answered: 2 });
  });

  it("mixes red to green by ratio", () => {
    expect(habitRatioColor(0, 2, "#ff0000", "#00ff00")).toBe("rgb(255, 0, 0)");
    expect(habitRatioColor(2, 2, "#ff0000", "#00ff00")).toBe("rgb(0, 255, 0)");
    expect(habitRatioColor(1, 2, "#ff0000", "#00ff00")).toBe("rgb(128, 128, 0)");
  });

  it("treats a day as logged only when some habit has yes or no", () => {
    const doc = parseMdhabit(emptyMdhabit(2026, "2026-08-15"));
    expect(dayIsLogged(doc, "2026-08-15")).toBe(false);
    const withNo = {
      ...doc,
      habits: [
        {
          name: "Water",
          question: "Q",
          color: "",
          dates: [],
          no: ["2026-08-15"],
        },
      ],
    };
    expect(dayIsLogged(withNo, "2026-08-15")).toBe(true);
  });
});
