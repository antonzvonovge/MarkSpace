import { memo } from "react";
import type { WeatherIconKind } from "../../lib/weather";

/** Flat weather marks sized for the dashboard widget. Coordinates are in a 64 viewBox. */

function SunMark() {
  return (
    <g>
      <circle cx="32" cy="32" r="16" fill="#FFE7A3" />
      <circle cx="32" cy="32" r="10" fill="#F6C445" />
      <g stroke="#E8A317" strokeWidth="2.6" strokeLinecap="round">
        <path d="M32 12v5M32 47v5M12 32h5M47 32h5M17.6 17.6l3.6 3.6M42.8 42.8l3.6 3.6M17.6 46.4l3.6-3.6M42.8 21.2l3.6-3.6" />
      </g>
    </g>
  );
}

function MoonMark() {
  return <path d="M42 16a16 16 0 1 0 8 28.2A12.5 12.5 0 1 1 42 16z" fill="#F6E7C1" />;
}

function CloudMark({ y = 0 }: { y?: number }) {
  return (
    <g transform={`translate(0 ${y})`}>
      <ellipse cx="28" cy="36" rx="14" ry="10" fill="#D5DEE8" />
      <ellipse cx="42" cy="34" rx="12" ry="11" fill="#EEF3F8" />
      <ellipse cx="34" cy="26" rx="11" ry="10" fill="#F7FAFC" />
      <rect x="16" y="32" width="32" height="12" rx="6" fill="#D9E2EC" />
      <path
        d="M18 38h28"
        fill="none"
        stroke="#C5D0DC"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </g>
  );
}

function RainDrops({ count }: { count: 2 | 3 }) {
  const drops =
    count === 3
      ? [
          [22, 50],
          [32, 54],
          [42, 50],
        ]
      : [
          [26, 52],
          [38, 54],
        ];
  return (
    <g fill="#38BDF8">
      {drops.map(([x, y]) => (
        <path
          key={`${x}-${y}`}
          d={`M${x} ${y}c0 2.2 1.5 3.4 2.4 3.4s2.4-1.2 2.4-3.4c0-2.1-2.4-4.8-2.4-4.8S${x} ${y - 2.1} ${x} ${y}z`}
        />
      ))}
    </g>
  );
}

function SnowMarks() {
  const flakes = [
    [22, 50],
    [34, 56],
    [46, 50],
  ] as const;
  return (
    <g stroke="#7DD3FC" strokeWidth="2.2" strokeLinecap="round">
      {flakes.map(([x, y]) => (
        <path
          key={`${x}-${y}`}
          d={`M${x} ${y - 5}v10M${x - 5} ${y}h10M${x - 3.5} ${y - 3.5}l7 7M${x + 3.5} ${y - 3.5}l-7 7`}
        />
      ))}
    </g>
  );
}

function FogMarks() {
  return (
    <g stroke="#94A3B8" strokeWidth="2.4" strokeLinecap="round">
      <path d="M16 50h32M18 56h26M22 62h16" />
    </g>
  );
}

function BoltMark() {
  return <path d="M38 30h-10l2.4 8h-7.2L40 56l-3.2-12h8.4z" fill="#F5B942" />;
}

export const WeatherGlyph = memo(function WeatherGlyph({ kind }: { kind: WeatherIconKind }) {
  return (
    <svg className="dashboard-weather-glyph" viewBox="0 0 64 64" aria-hidden="true">
      {kind === "clear-day" ? <SunMark /> : null}
      {kind === "clear-night" ? <MoonMark /> : null}
      {kind === "partly-day" ? (
        <>
          <g transform="translate(-4 -8) scale(0.62)">
            <SunMark />
          </g>
          <CloudMark y={6} />
        </>
      ) : null}
      {kind === "partly-night" ? (
        <>
          <g transform="translate(0 -6) scale(0.62)">
            <MoonMark />
          </g>
          <CloudMark y={6} />
        </>
      ) : null}
      {kind === "cloudy" ? <CloudMark y={4} /> : null}
      {kind === "fog" ? (
        <>
          <CloudMark y={-6} />
          <FogMarks />
        </>
      ) : null}
      {kind === "drizzle" ? (
        <>
          <CloudMark y={-4} />
          <RainDrops count={2} />
        </>
      ) : null}
      {kind === "rain" ? (
        <>
          <CloudMark y={-6} />
          <RainDrops count={3} />
        </>
      ) : null}
      {kind === "snow" ? (
        <>
          <CloudMark y={-10} />
          <SnowMarks />
        </>
      ) : null}
      {kind === "storm" ? (
        <>
          <CloudMark y={-8} />
          <BoltMark />
        </>
      ) : null}
    </svg>
  );
});
