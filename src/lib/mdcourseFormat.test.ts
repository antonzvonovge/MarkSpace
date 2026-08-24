import { describe, expect, it } from "vitest";
import {
  MDCOURSE_HEADER,
  applyTrackDay,
  barDateRange,
  completeDaysCount,
  courseSegmentKind,
  emptyMdcourse,
  findTrackIndex,
  isMonday,
  parseMdcourse,
  serializeMdcourse,
  setTrackDay,
  tracksForBar,
} from "./mdcourseFormat";

describe("mdcourseFormat", () => {
  it("parses empty document", () => {
    const src = emptyMdcourse("2026-08-24");
    const doc = parseMdcourse(src);
    expect(doc).toEqual({ created: "2026-08-24", tracks: [] });
  });

  it("round-trips finite and ongoing tracks with log", () => {
    const src = `${MDCOURSE_HEADER}
created: 2026-08-24

Ascorutin
question: Did you take Ascorutin as prescribed?
when: after meals
times: 3
start: 2026-08-24
days: 28
color: #2196f3
log: 2026-08-24:2 2026-08-25:0

SPF
question: Did you apply SPF?
when: morning
times: 1
start: 2026-08-24
ongoing: true
log: 2026-08-24:1
`;
    const doc = parseMdcourse(src);
    expect(doc.tracks).toHaveLength(2);
    expect(doc.tracks[0]).toMatchObject({
      name: "Ascorutin",
      times: 3,
      days: 28,
      ongoing: false,
      time: [],
      weekdays: [],
      log: { "2026-08-24": 2, "2026-08-25": 0 },
    });
    expect(doc.tracks[1]!.ongoing).toBe(true);
    expect(doc.tracks[1]!.days).toBeNull();
    expect(parseMdcourse(serializeMdcourse(doc))).toEqual(doc);
  });

  it("rejects both days and ongoing, missing window, duplicates", () => {
    expect(() => parseMdcourse("# wrong\n")).toThrow(/header/i);
    expect(() => parseMdcourse(`${MDCOURSE_HEADER}\n`)).toThrow(/created/i);
    expect(() =>
      parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-24

A
question: Q
start: 2026-08-24
days: 7
ongoing: true
`),
    ).toThrow(/both/i);
    expect(() =>
      parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-24

A
question: Q
start: 2026-08-24
`),
    ).toThrow(/days: or ongoing/i);
    expect(() =>
      parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-24

Water
question: A
start: 2026-08-24
days: 7

water
question: B
start: 2026-08-24
days: 7
`),
    ).toThrow(/duplicate/i);
  });

  it("sorts bar tracks with longest at the bottom", () => {
    const doc = parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-24

Short
question: Q
start: 2026-08-24
days: 7

Mid
question: Q
start: 2026-08-24
days: 28

Forever
question: Q
start: 2026-08-24
ongoing: true
`);
    const bar = tracksForBar(doc.tracks);
    expect(bar.map((t) => t.name)).toEqual(["Short", "Mid", "Forever"]);
  });

  it("computes bar range from tracks and pads ongoing", () => {
    const doc = parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-01

Vit
question: Q
start: 2026-08-01
days: 10
`);
    expect(barDateRange(doc.tracks, "2026-08-05")).toEqual({
      from: "2026-08-01",
      to: "2026-08-10",
    });
    const withOn = parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-01

Vit
question: Q
start: 2026-08-01
days: 10

SPF
question: Q
start: 2026-08-01
ongoing: true
`);
    expect(barDateRange(withOn.tracks, "2026-08-05").to).toBe("2026-08-12");
  });

  it("paints segments from log and window", () => {
    const track = parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-24

A
question: Q
times: 3
start: 2026-08-24
days: 7
log: 2026-08-24:2 2026-08-25:0
`).tracks[0]!;
    expect(courseSegmentKind(track, "2026-08-20", 0, "2026-08-26")).toBe("out");
    expect(courseSegmentKind(track, "2026-08-24", 0, "2026-08-26")).toBe("done");
    expect(courseSegmentKind(track, "2026-08-24", 1, "2026-08-26")).toBe("done");
    expect(courseSegmentKind(track, "2026-08-24", 2, "2026-08-26")).toBe("plan");
    expect(courseSegmentKind(track, "2026-08-25", 0, "2026-08-26")).toBe(
      "missed",
    );
    expect(courseSegmentKind(track, "2026-08-26", 0, "2026-08-26")).toBe("plan");
    expect(courseSegmentKind(track, "2026-08-27", 0, "2026-08-26")).toBe("plan");
  });

  it("sets log counts and complete-day progress", () => {
    const tracks = parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-24

A
question: Q
times: 2
start: 2026-08-24
days: 3
`).tracks;
    expect(findTrackIndex(tracks, "a")).toBe(0);
    const next = setTrackDay(tracks, "A", "2026-08-24", 2);
    expect(completeDaysCount(next[0]!)).toBe(1);
    const applied = applyTrackDay(next, "2026-08-25", { a: 0 });
    expect(applied[0]!.log["2026-08-25"]).toBe(0);
  });

  it("detects Mondays", () => {
    expect(isMonday("2026-08-24")).toBe(true);
    expect(isMonday("2026-08-25")).toBe(false);
  });

  it("parses weekdays and clock times and skips off days", () => {
    const doc = parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-24

Gym
question: Did you train?
time: 8:00 19:30
weekdays: Mon Wed Fri
start: 2026-08-24
days: 7
times: 2
`);
    const gym = doc.tracks[0]!;
    expect(gym.time).toEqual(["08:00", "19:30"]);
    expect(gym.weekdays).toEqual([1, 3, 5]);
    expect(courseSegmentKind(gym, "2026-08-24", 0, "2026-08-24")).toBe("plan");
    expect(courseSegmentKind(gym, "2026-08-25", 0, "2026-08-24")).toBe("out");
    expect(parseMdcourse(serializeMdcourse(doc)).tracks[0]).toMatchObject({
      time: ["08:00", "19:30"],
      weekdays: [1, 3, 5],
    });
  });

  it("keeps a blank clock per skipped segment", () => {
    const doc = parseMdcourse(`${MDCOURSE_HEADER}
created: 2026-08-24

Pills
question: Q
time: 08:00 - 20:00
times: 3
start: 2026-08-24
days: 7
`);
    expect(doc.tracks[0]!.time).toEqual(["08:00", "", "20:00"]);
    expect(serializeMdcourse(doc)).toContain("time: 08:00 - 20:00");
  });
});
