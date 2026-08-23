import { describe, expect, it } from "vitest";
import { resolveAudioEmbedPath } from "./AudioEmbedBlock";

describe("resolveAudioEmbedPath", () => {
  it("joins a bare filename to the note folder", () => {
    expect(
      resolveAudioEmbedPath(
        "listening.wav",
        "English/IELTS/Practice/23.08.2026-listening/session.md",
      ),
    ).toBe("English/IELTS/Practice/23.08.2026-listening/listening.wav");
  });

  it("keeps vault-relative paths", () => {
    expect(resolveAudioEmbedPath("Practice/clip.mp3", "English/Note.md")).toBe(
      "Practice/clip.mp3",
    );
  });
});
