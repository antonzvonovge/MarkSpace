/** First/last index of audible samples, with a short pad so attacks are not clipped. */
export function silenceBounds(
  samples: Float32Array,
  threshold = 0.02,
  padSamples = 0,
): { start: number; end: number } {
  let start = 0;
  let end = samples.length - 1;
  while (start < samples.length && Math.abs(samples[start]!) < threshold) start += 1;
  while (end > start && Math.abs(samples[end]!) < threshold) end -= 1;
  if (start >= samples.length) return { start: 0, end: -1 };
  start = Math.max(0, start - padSamples);
  end = Math.min(samples.length - 1, end + padSamples);
  return { start, end };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Wrap raw little-endian 16-bit mono PCM (e.g. ElevenLabs pcm_24000). */
export function wrapPcm16LeWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const dataSize = pcm.byteLength - (pcm.byteLength % 2);
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(out, 44, dataSize).set(pcm.subarray(0, dataSize));
  return new Uint8Array(out);
}

/** 16-bit mono WAV for the HTML player (no MP3 encoder delay). */
export function encodeMonoWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataSize = samples.length * 2;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Uint8Array(out);
}

export function concatMonoWithGaps(
  clips: Float32Array[],
  gapSamples: number,
): Float32Array {
  if (clips.length === 0) return new Float32Array(0);
  const gap = Math.max(0, gapSamples);
  let total = 0;
  for (let i = 0; i < clips.length; i++) {
    total += clips[i]!.length;
    if (i < clips.length - 1) total += gap;
  }
  const out = new Float32Array(total);
  let o = 0;
  for (let i = 0; i < clips.length; i++) {
    out.set(clips[i]!, o);
    o += clips[i]!.length;
    if (i < clips.length - 1) o += gap;
  }
  return out;
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

/**
 * Decode MP3 clips, strip encoder padding, stitch with a short speaker gap.
 * Falls back to null if Web Audio cannot decode (player should use raw MP3).
 */
export async function prepareIeltsPlaybackWav(
  clips: Uint8Array[],
): Promise<{ bytes: Uint8Array; mime: "audio/wav" } | null> {
  if (clips.length === 0 || typeof AudioContext === "undefined") return null;
  const ctx = new AudioContext();
  try {
    const decoded: AudioBuffer[] = [];
    for (const clip of clips) {
      try {
        decoded.push(await ctx.decodeAudioData(copyBuffer(clip)));
      } catch {
        return null;
      }
    }
    if (decoded.length === 0) return null;
    const sampleRate = decoded[0]!.sampleRate;
    const pad = Math.floor(sampleRate * 0.025);
    const gap = Math.floor(sampleRate * 0.09);
    const pieces: Float32Array[] = [];
    for (const buf of decoded) {
      const ch = buf.getChannelData(0);
      const { start, end } = silenceBounds(ch, 0.018, pad);
      if (end < start) continue;
      pieces.push(ch.slice(start, end + 1));
    }
    if (pieces.length === 0) return null;
    const mono = concatMonoWithGaps(pieces, gap);
    return { bytes: encodeMonoWav(mono, sampleRate), mime: "audio/wav" };
  } finally {
    void ctx.close();
  }
}
