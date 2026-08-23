import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { MdPause, MdPlayArrow } from "react-icons/md";
import { absolutePath, readFileBytes } from "../../lib/vaultApi";
import { Select } from "../ui/Select";

type Props = {
  /** Vault-relative path of the audio file. */
  path: string;
  label?: string;
};

const PLAYBACK_RATES = [0.75, 0.9, 1, 1.1, 1.25] as const;
const PLAYBACK_RATE_OPTIONS = PLAYBACK_RATES.map((r) => ({
  value: String(r),
  label: `${r}×`,
}));

export function formatAudioTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Media duration, falling back to the seekable range while metadata loads. */
export function readMediaDuration(el: HTMLAudioElement): number {
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  if (el.seekable.length > 0) {
    const end = el.seekable.end(el.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) return end;
  }
  return 0;
}

const AUDIO_MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  aac: "audio/aac",
};

export function audioMimeForPath(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return AUDIO_MIME[ext] ?? "audio/mpeg";
}

export function mediaErrorLabel(error: MediaError | null): string {
  const code = error?.code ?? 0;
  const detail = error?.message?.trim();
  const kind =
    code === 1
      ? "aborted"
      : code === 2
        ? "network"
        : code === 3
          ? "decode"
          : code === 4
            ? "format not supported"
            : "unknown";
  return detail ? `${kind}: ${detail}` : kind;
}

function Scrubber({
  current,
  duration,
  onSeek,
}: {
  current: number;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const seekable = duration > 0;
  const ratio = seekable ? Math.min(1, Math.max(0, current / duration)) : 0;

  const timeAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.min(duration, Math.max(0, x * duration));
  };

  return (
    <div
      ref={trackRef}
      className="ms-audio-track"
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(current)}
      aria-valuetext={`${formatAudioTime(current)} of ${formatAudioTime(duration)}`}
      tabIndex={seekable ? 0 : -1}
      onPointerDown={(e) => {
        if (!seekable) return;
        e.preventDefault();
        e.stopPropagation();
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        onSeek(timeAt(e.clientX));
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onKeyDown={(e) => {
        if (!seekable) return;
        const step = Math.max(1, duration * 0.05);
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onSeek(Math.min(duration, current + step));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onSeek(Math.max(0, current - step));
        } else if (e.key === "Home") {
          e.preventDefault();
          onSeek(0);
        } else if (e.key === "End") {
          e.preventDefault();
          onSeek(duration);
        }
      }}
    >
      <div className="ms-audio-fill" style={{ width: `${ratio * 100}%` }}>
        <span className="ms-audio-knob" />
      </div>
    </div>
  );
}

/**
 * Vault audio through the Tauri asset protocol: the webview streams the file
 * with range requests, so playback starts immediately and seeking works
 * (blob URLs give neither on WebKitGTK).
 */
export function AudioPlayer({ path, label }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const triedBlobRef = useRef(false);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  const revokeBlob = () => {
    if (!blobUrlRef.current) return;
    URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    revokeBlob();
    triedBlobRef.current = false;
    setSrc(null);
    setError(null);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    const run = async () => {
      const rel = path.trim();
      if (!rel) return;
      try {
        const abs = await absolutePath(rel);
        if (cancelled) return;
        setSrc(convertFileSrc(abs));
      } catch {
        if (!cancelled) setError("Audio file not found in the vault.");
      }
    };
    void run();
    return () => {
      cancelled = true;
      revokeBlob();
    };
  }, [path]);

  /** WebKitGTK refuses some custom-scheme media; retry the bytes as a blob. */
  const onMediaError = (el: HTMLAudioElement) => {
    const reason = mediaErrorLabel(el.error);
    if (triedBlobRef.current) {
      setError(`Could not play this audio file (${reason}).`);
      return;
    }
    triedBlobRef.current = true;
    void (async () => {
      try {
        const file = await readFileBytes(path);
        const binary = atob(file.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: audioMimeForPath(path) });
        revokeBlob();
        blobUrlRef.current = URL.createObjectURL(blob);
        setSrc(blobUrlRef.current);
      } catch {
        setError(`Could not play this audio file (${reason}).`);
      }
    })();
  };

  const seekTo = (seconds: number) => {
    const el = audioRef.current;
    setCurrent(seconds);
    if (!el) return;
    try {
      el.currentTime = seconds;
    } catch {
      /* not buffered yet */
    }
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el || !src) return;
    if (playing) {
      el.pause();
      return;
    }
    el.playbackRate = rate;
    void el.play().catch(() => setError("Could not play this audio file."));
  };

  return (
    <div className="ms-audio">
      {label ? <div className="ms-audio-label">{label}</div> : null}
      <div className="ms-audio-bar">
        {src ? (
          <audio
            ref={audioRef}
            className="ms-audio-media"
            src={src}
            preload="metadata"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              el.playbackRate = rate;
              setDuration(readMediaDuration(el));
              setError(null);
            }}
            onDurationChange={(e) => setDuration(readMediaDuration(e.currentTarget))}
            onProgress={(e) => setDuration(readMediaDuration(e.currentTarget))}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={(e) => onMediaError(e.currentTarget)}
          />
        ) : null}
        <button
          type="button"
          className="ms-audio-play"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          disabled={!src}
          onClick={toggle}
        >
          {playing ? <MdPause size={20} /> : <MdPlayArrow size={20} />}
        </button>
        <Scrubber current={current} duration={duration} onSeek={seekTo} />
        <span className="ms-audio-time">
          {formatAudioTime(current)} / {formatAudioTime(duration)}
        </span>
        <Select
          className="ms-audio-rate"
          variant="setting"
          aria-label="Playback speed"
          value={String(rate)}
          options={PLAYBACK_RATE_OPTIONS}
          onChange={(v) => {
            const next = Number(v);
            setRate(next);
            if (audioRef.current) audioRef.current.playbackRate = next;
          }}
        />
      </div>
      {error ? <p className="ms-audio-error">{error}</p> : null}
    </div>
  );
}
