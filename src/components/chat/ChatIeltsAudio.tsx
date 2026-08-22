import { useEffect, useMemo, useRef, useState } from "react";
import { MdPause, MdPlayArrow } from "react-icons/md";
import { concatMp3Buffers } from "../../ai/ieltsDialogue";
import { readFileBytes } from "../../lib/vaultApi";
import { useIeltsUiStore } from "../../store/ieltsUiStore";
import { Select } from "../ui/Select";

type Props = {
  paths: string[];
};

function bytesFromBase64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: mime });
}

function mimeForPaths(paths: string[]): string {
  if (paths.every((p) => p.toLowerCase().endsWith(".wav"))) return "audio/wav";
  return "audio/mpeg";
}

async function loadClipBytes(path: string): Promise<Uint8Array> {
  const file = await readFileBytes(path);
  const bytes = bytesFromBase64(file.dataBase64);
  if (bytes.byteLength < 32) {
    throw new Error("empty clip");
  }
  return bytes;
}

const PLAYBACK_RATES = [0.75, 0.9, 1, 1.1, 1.25] as const;
const PLAYBACK_RATE_OPTIONS = PLAYBACK_RATES.map((r) => ({
  value: String(r),
  label: `${r}×`,
}));

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function ChatIeltsAudio({ paths }: Props) {
  const pathKey = useMemo(() => paths.join("\n"), [paths]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const createdRef = useRef<string | null>(null);
  const sequenceDone = useRef(false);
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setLoadError(null);
    setPhase("loading");
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setRate(1);
    sequenceDone.current = false;
    useIeltsUiStore.getState().patch({
      listeningPlaybackEnded: false,
    });

    const run = async () => {
      try {
        const list = pathKey.split("\n").filter(Boolean);
        const clips = await Promise.all(list.map((p) => loadClipBytes(p)));
        if (cancelled) return;
        const packed =
          clips.length === 1 ? clips[0]! : concatMp3Buffers(clips);
        const url = URL.createObjectURL(bytesToBlob(packed, mimeForPaths(list)));
        createdRef.current = url;
        setSrc(url);
        setPhase("ready");
      } catch {
        if (!cancelled) {
          setPhase("error");
          setLoadError("Could not load listening audio from the vault.");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (createdRef.current) {
        URL.revokeObjectURL(createdRef.current);
        createdRef.current = null;
      }
    };
  }, [pathKey]);

  const onToggle = () => {
    const el = audioRef.current;
    if (!el || !src) return;
    if (playing) {
      el.pause();
      return;
    }
    if (el.ended) {
      sequenceDone.current = false;
      el.currentTime = 0;
    }
    el.playbackRate = rate;
    void el.play();
  };

  const onSeek = (value: number) => {
    const el = audioRef.current;
    if (!el) return;
    sequenceDone.current = false;
    el.currentTime = value;
    setCurrent(value);
  };

  const onRate = (next: number) => {
    setRate(next);
    const el = audioRef.current;
    if (el) el.playbackRate = next;
  };

  const status =
    phase === "error"
      ? loadError
      : phase === "loading"
        ? "Loading audio…"
        : null;

  return (
    <div className="chat-ielts-audio">
      <div className="chat-ielts-audio-label">
        Listening audio
      </div>
      {src && phase !== "loading" ? (
        <div className="chat-ielts-player">
          <audio
            ref={audioRef}
            className="chat-ielts-player-native"
            src={src}
            preload="auto"
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration || 0);
              e.currentTarget.playbackRate = rate;
            }}
            onDurationChange={(e) => {
              setDuration(e.currentTarget.duration || 0);
            }}
            onTimeUpdate={(e) => {
              setCurrent(e.currentTarget.currentTime);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={(e) => {
              sequenceDone.current = true;
              setPlaying(false);
              setCurrent(e.currentTarget.duration || 0);
              useIeltsUiStore.getState().patch({ listeningPlaybackEnded: true });
            }}
            onError={() => {
              setLoadError("Could not play listening audio.");
            }}
          />
          <button
            type="button"
            className="chat-ielts-player-play"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
            onClick={onToggle}
          >
            {playing ? <MdPause size={20} /> : <MdPlayArrow size={20} />}
          </button>
          <input
            type="range"
            className="chat-ielts-player-seek"
            min={0}
            max={duration || 0}
            step={0.05}
            value={Math.min(current, duration)}
            onChange={(e) => onSeek(Number(e.target.value))}
          />
          <span className="chat-ielts-player-time">
            {formatTime(current)} / {formatTime(duration)}
          </span>
          <Select
              className="chat-ielts-player-rate"
              variant="setting"
              aria-label="Playback speed"
              value={String(rate)}
              options={PLAYBACK_RATE_OPTIONS}
              onChange={(v) => onRate(Number(v))}
            />
        </div>
      ) : (
        <p className="chat-ielts-audio-empty">{status}</p>
      )}
      {loadError && phase === "ready" ? (
        <p className="chat-ielts-audio-empty">{loadError}</p>
      ) : null}
    </div>
  );
}
