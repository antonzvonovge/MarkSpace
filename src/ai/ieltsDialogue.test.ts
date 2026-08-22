import { describe, expect, it } from "vitest";
import {
  groupDialogueTurns,
  resolveIeltsFolder,
  ieltsSessionFileStem,
  topicsFromSessionFilenames,
  expandIeltsTtsText,
  concatMp3Buffers,
  dialogueToAzureSsml,
  nestIeltsBundleFolder,
} from "./ieltsDialogue";

describe("groupDialogueTurns", () => {
  it("assigns different voices and keeps dialogue order", () => {
    const turns = groupDialogueTurns([
      { speaker: "Receptionist", text: "Hello." },
      { speaker: "Caller", text: "Hi." },
      { speaker: "Receptionist", text: "Name?" },
      { speaker: "Caller", text: "Bennett." },
    ]);
    expect(turns.map((t) => t.voiceIndex)).toEqual([0, 1, 0, 1]);
    expect(turns.map((t) => t.text)).toEqual([
      "Hello.",
      "Hi.",
      "Name?",
      "Bennett.",
    ]);
  });

  it("merges consecutive lines from the same speaker", () => {
    const turns = groupDialogueTurns([
      { speaker: "A", text: "One." },
      { speaker: "A", text: "Two." },
      { speaker: "B", text: "Three." },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      speaker: "A",
      text: "One. Two.",
      voiceIndex: 0,
    });
    expect(turns[1]?.voiceIndex).toBe(1);
  });
});

describe("resolveIeltsFolder", () => {
  it("uses the picked path as-is", () => {
    expect(resolveIeltsFolder("/IELTS/План подготовки/Listening/")).toBe(
      "IELTS/План подготовки/Listening",
    );
  });
});

describe("topicsFromSessionFilenames", () => {
  it("extracts unique topic slugs from dated session notes", () => {
    expect(
      topicsFromSessionFilenames([
        "22.08.2026-14.05-section-1-community-centre-booking.md",
        "English/IELTS/22.08.2026-section-1-community-centre-booking.md",
        ".folder.md",
        "notes.md",
        "23.08.2026-section-2-museum-tour.md",
        "23.08.2026-section-1-community-centre-booking.md",
      ]),
    ).toEqual([
      "section-1-community-centre-booking",
      "section-2-museum-tour",
    ]);
  });
});

describe("dialogueToAzureSsml", () => {
  it("uses British voices and spells letter runs as characters", () => {
    const ssml = dialogueToAzureSsml([
      { speaker: "Receptionist", text: "Can I take your name?" },
      { speaker: "Customer", text: "Yes, it's Harper, H-A-R-P-E-R." },
    ]);
    expect(ssml).toContain("en-GB-SoniaNeural");
    expect(ssml).toContain("en-GB-RyanNeural");
    expect(ssml).toContain('interpret-as="characters"');
    expect(ssml).toContain("HARPER");
    expect(ssml).toContain("Harper");
    expect(ssml).not.toMatch(/<\/voice>\s*<break/);
    expect(ssml).toContain("<voice name=\"en-GB-RyanNeural\"><break time=\"400ms\"/>");
  });

  it("normalizes curly apostrophes before SSML", () => {
    const ssml = dialogueToAzureSsml([
      { speaker: "A", text: "She\u2019s vegetarian. That\u2019s no problem." },
    ]);
    expect(ssml).toContain("She&apos;s vegetarian");
    expect(ssml).not.toContain("\u2019");
  });
});

describe("expandIeltsTtsText", () => {
  it("slows hyphenated letter spelling", () => {
    const out = expandIeltsTtsText("That's B-E-N-N-E-T-T.");
    expect(out.slow).toBe(true);
    expect(out.text).toContain("B,");
    expect(out.text).toContain("...");
  });

  it("leaves ordinary sentences at normal pace", () => {
    const out = expandIeltsTtsText("Good morning, Wildlife Centre.");
    expect(out.slow).toBe(false);
    expect(out.text).toBe("Good morning, Wildlife Centre.");
  });
});

describe("concatMp3Buffers", () => {
  it("joins clips in order", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    expect(Array.from(concatMp3Buffers([a, b]))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("ieltsSessionFileStem", () => {
  it("prefixes local dd.MM.YYYY-HH.mm", () => {
    expect(
      ieltsSessionFileStem(
        "section-1-community-centre-booking",
        new Date(2026, 7, 22, 14, 5),
      ),
    ).toBe("22.08.2026-14.05-section-1-community-centre-booking");
  });

  it("does not double the date-time prefix", () => {
    expect(
      ieltsSessionFileStem(
        "22.08.2026-14.05-listening-s1",
        new Date(2026, 7, 22, 18, 0),
      ),
    ).toBe("22.08.2026-18.00-listening-s1");
  });
});

describe("nestIeltsBundleFolder", () => {
  it("nests a dated session folder under the picked parent", () => {
    expect(
      nestIeltsBundleFolder(
        "English/IELTS/Listening",
        "22.08.2026-section-1-cabin",
      ),
    ).toBe("English/IELTS/Listening/22.08.2026-section-1-cabin");
  });

  it("does not nest twice", () => {
    expect(
      nestIeltsBundleFolder(
        "English/IELTS/Listening/22.08.2026-section-1-cabin",
        "22.08.2026-other",
      ),
    ).toBe("English/IELTS/Listening/22.08.2026-section-1-cabin");
  });
});
