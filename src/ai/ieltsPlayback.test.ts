import { describe, expect, it } from "vitest";
import {
  concatMonoWithGaps,
  encodeMonoWav,
  silenceBounds,
  wrapPcm16LeWav,
} from "./ieltsPlayback";

describe("silenceBounds", () => {
  it("skips leading and trailing hush", () => {
    const samples = new Float32Array([0, 0, 0, 0.4, 0.5, 0, 0]);
    expect(silenceBounds(samples, 0.02, 0)).toEqual({ start: 3, end: 4 });
  });

  it("keeps a pad before the first peak", () => {
    const samples = new Float32Array([0, 0, 0, 0.4, 0.5, 0]);
    expect(silenceBounds(samples, 0.02, 1)).toEqual({ start: 2, end: 5 });
  });
});

describe("concatMonoWithGaps", () => {
  it("inserts zeros between clips, not before the first", () => {
    const out = concatMonoWithGaps(
      [new Float32Array([1, 1]), new Float32Array([2])],
      2,
    );
    expect(Array.from(out)).toEqual([1, 1, 0, 0, 2]);
  });
});

describe("encodeMonoWav", () => {
  it("writes a RIFF header", () => {
    const wav = encodeMonoWav(new Float32Array([0, 0.5, -0.5]), 24000);
    const tag = String.fromCharCode(...wav.subarray(0, 4));
    expect(tag).toBe("RIFF");
    expect(wav.byteLength).toBe(44 + 6);
  });
});

describe("wrapPcm16LeWav", () => {
  it("prefixes a PCM payload with a WAV header", () => {
    const wav = wrapPcm16LeWav(new Uint8Array([0, 0, 1, 0]), 24000);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(wav.byteLength).toBe(48);
  });
});
