import { memo, useEffect, useState } from "react";
import {
  cachedWeather,
  fetchCurrentWeather,
  formatPlace,
  ignoreAbort,
  searchCities,
  weatherDetail,
  weatherPhrase,
  weatherPresentation,
  WEATHER_REFRESH_MS,
  type CurrentWeather,
  type WeatherPlace,
} from "../../lib/weather";
import { usePrefsStore } from "../../store/prefsStore";
import { WeatherGlyph } from "./WeatherGlyph";

type Readout =
  | { phase: "loading" }
  | { phase: "ready"; weather: CurrentWeather }
  | { phase: "error" };

function formatTemperature(weather: CurrentWeather): string {
  const unit =
    weather.temperatureUnit === "°C" || weather.temperatureUnit === "°F"
      ? weather.temperatureUnit
      : "°";
  return `${Math.round(weather.temperature)}${unit}`;
}

const CitySearch = memo(function CitySearch({
  onPick,
  onCancel,
}: {
  onPick: (place: WeatherPlace) => void;
  onCancel?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherPlace[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("loading");
      void searchCities(trimmed, controller.signal)
        .then((places) => {
          setResults(places);
          setStatus(places.length === 0 ? "empty" : "idle");
        })
        .catch((err: unknown) => {
          if (ignoreAbort(err)) return;
          setResults([]);
          setStatus("error");
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const trimmed = query.trim();
  const showIdle = trimmed.length < 2;

  return (
    <div className="dashboard-weather-search">
      <input
        className="dashboard-weather-input"
        value={query}
        placeholder="City"
        aria-label="City"
        autoFocus
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (next.trim().length < 2) {
            setResults([]);
            setStatus("idle");
          }
        }}
      />
      {showIdle ? <p className="dashboard-widget-empty">Type a city name</p> : null}
      {!showIdle && status === "loading" ? (
        <p className="dashboard-widget-empty">Searching…</p>
      ) : null}
      {!showIdle && status === "empty" ? (
        <p className="dashboard-widget-empty">No matching cities</p>
      ) : null}
      {!showIdle && status === "error" ? (
        <p className="dashboard-widget-empty">Could not search cities</p>
      ) : null}
      {results.length > 0 ? (
        <div className="dashboard-weather-hits" role="listbox" aria-label="Cities">
          {results.map((place) => (
            <button
              key={`${place.name}-${place.latitude}-${place.longitude}`}
              type="button"
              role="option"
              className="dashboard-weather-hit"
              onClick={() => onPick(place)}
            >
              {formatPlace(place)}
            </button>
          ))}
        </div>
      ) : null}
      {onCancel ? (
        <button type="button" className="dashboard-weather-cancel" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </div>
  );
});

const WeatherReadout = memo(function WeatherReadout({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  const language = usePrefsStore((s) => s.prefs.nativeLanguage);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<Readout>(() => {
    const cached = cachedWeather(latitude, longitude);
    return cached ? { phase: "ready", weather: cached } : { phase: "loading" };
  });

  useEffect(() => {
    let cancelled = false;
    let active: AbortController | null = null;

    const apply = (weather: CurrentWeather) => {
      if (!cancelled) setState({ phase: "ready", weather });
    };

    const load = (force: boolean) => {
      if (!force) {
        const hit = cachedWeather(latitude, longitude);
        if (hit) {
          apply(hit);
          return;
        }
      }
      active?.abort();
      const controller = new AbortController();
      active = controller;
      void fetchCurrentWeather(latitude, longitude, controller.signal)
        .then(apply)
        .catch((err: unknown) => {
          if (cancelled || ignoreAbort(err)) return;
          setState((current) => (current.phase === "ready" ? current : { phase: "error" }));
        });
    };

    const hit = cachedWeather(latitude, longitude);
    if (hit) apply(hit);
    else setState({ phase: "loading" });
    load(false);

    const timer = window.setInterval(() => load(true), WEATHER_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      active?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [latitude, longitude, retry]);

  if (state.phase === "loading") {
    return <p className="dashboard-widget-empty">Loading…</p>;
  }
  if (state.phase === "error") {
    return (
      <div className="dashboard-weather-search">
        <p className="dashboard-widget-empty">Could not load weather</p>
        <button
          type="button"
          className="dashboard-weather-cancel"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  const view = weatherPresentation(state.weather.code, state.weather.isDay);
  return (
    <div className="dashboard-weather">
      <div className="dashboard-weather-main">
        <WeatherGlyph kind={view.kind} />
        <p className="dashboard-weather-temp">{formatTemperature(state.weather)}</p>
      </div>
      <div className="dashboard-weather-copy">
        <p className="dashboard-weather-condition">{weatherPhrase(view.phrase, language)}</p>
        <p className="dashboard-weather-meta">
          {weatherDetail("humidity", state.weather.humidity, language)}
        </p>
        <p className="dashboard-weather-meta">
          {weatherDetail("wind", state.weather.wind, language, state.weather.windUnit)}
        </p>
      </div>
    </div>
  );
});

export const WeatherWidget = memo(function WeatherWidget({
  place,
  admin,
  country,
  latitude,
  longitude,
  onRemove,
  onPlace,
}: {
  place: string;
  admin: string;
  country: string;
  latitude?: number;
  longitude?: number;
  onRemove: () => void;
  onPlace: (place: WeatherPlace) => void;
}) {
  const configured =
    place.length > 0 && latitude !== undefined && longitude !== undefined;
  const [editing, setEditing] = useState(false);
  const title = configured ? formatPlace({ name: place, admin, country }) : "Weather";

  return (
    <article className="dashboard-widget is-weather">
      <header className="dashboard-widget-handle">
        <span className="dashboard-widget-title">{title}</span>
        {configured && !editing ? (
          <button
            type="button"
            className="dashboard-widget-edit"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          className="dashboard-widget-remove"
          aria-label="Remove widget"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </header>
      <div className="dashboard-widget-body">
        {!configured || editing ? (
          <CitySearch
            onPick={(next) => {
              setEditing(false);
              onPlace(next);
            }}
            onCancel={configured ? () => setEditing(false) : undefined}
          />
        ) : (
          <WeatherReadout latitude={latitude} longitude={longitude} />
        )}
      </div>
    </article>
  );
});
