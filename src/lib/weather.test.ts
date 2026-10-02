import { describe, expect, it } from "vitest";
import {
  WEATHER_REFRESH_MS,
  cachedWeather,
  formatPlace,
  parseCitySearch,
  parseCurrentWeather,
  rememberWeather,
  weatherDetail,
  weatherPhrase,
  weatherPresentation,
} from "./weather";

describe("weather", () => {
  it("formats a city with its region and country", () => {
    expect(
      formatPlace({ name: "Springfield", admin: "Illinois", country: "United States" }),
    ).toBe("Springfield, Illinois, United States");
    expect(formatPlace({ name: "Tbilisi", admin: "Tbilisi", country: "Georgia" })).toBe(
      "Tbilisi, Georgia",
    );
  });

  it("maps weather codes to an icon and a phrase", () => {
    expect(weatherPresentation(0, true)).toEqual({ kind: "clear-day", phrase: "clear" });
    expect(weatherPresentation(0, false)).toEqual({ kind: "clear-night", phrase: "clear" });
    expect(weatherPresentation(2, true).kind).toBe("partly-day");
    expect(weatherPresentation(61, true)).toEqual({ kind: "rain", phrase: "rain" });
    expect(weatherPresentation(73, true).kind).toBe("snow");
    expect(weatherPresentation(95, false).kind).toBe("storm");
    expect(weatherPresentation(45, true).phrase).toBe("fog");
  });

  it("writes conditions in the profile native language", () => {
    expect(weatherPhrase("overcast", "ru")).toBe("Пасмурно");
    expect(weatherPhrase("overcast", "en")).toBe("Overcast");
    expect(weatherPhrase("storm", "ka")).toBe("ჭექა-ქუხილი");
    expect(weatherPhrase("clear", "xx")).toBe("Clear");
    expect(weatherDetail("humidity", 80.4, "ru")).toBe("Влажность 80%");
    expect(weatherDetail("wind", 10.6, "ru", "km/h")).toBe("Ветер 11 км/ч");
    expect(weatherDetail("wind", 10.6, "en", "km/h")).toBe("Wind 11 km/h");
  });

  it("parses a geocoding payload and drops bad coordinates", () => {
    const places = parseCitySearch({
      results: [
        {
          name: "Tbilisi",
          admin1: "Tbilisi",
          country: "Georgia",
          latitude: 41.69,
          longitude: 44.83,
        },
        { name: "Nowhere", latitude: 120, longitude: 0 },
      ],
    });
    expect(places).toEqual([
      {
        name: "Tbilisi",
        admin: "Tbilisi",
        country: "Georgia",
        latitude: 41.69,
        longitude: 44.83,
      },
    ]);
    expect(parseCitySearch({ hello: true })).toEqual([]);
  });

  it("parses current conditions", () => {
    expect(
      parseCurrentWeather({
        current: {
          temperature_2m: 21.6,
          relative_humidity_2m: 48,
          weather_code: 1,
          wind_speed_10m: 7.2,
          is_day: 1,
        },
        current_units: { temperature_2m: "°C", wind_speed_10m: "km/h" },
      }),
    ).toMatchObject({
      temperature: 21.6,
      temperatureUnit: "°C",
      humidity: 48,
      code: 1,
      isDay: true,
    });
    expect(parseCurrentWeather({})).toBeNull();
  });

  it("forgets cached weather after the refresh window", () => {
    const weather = {
      temperature: 10,
      temperatureUnit: "°C",
      humidity: 40,
      wind: 3,
      windUnit: "km/h",
      code: 0,
      isDay: true,
    };
    rememberWeather(1, 2, weather, 1_000);
    expect(cachedWeather(1, 2, 1_000 + WEATHER_REFRESH_MS)).toBe(weather);
    expect(cachedWeather(1, 2, 1_001 + WEATHER_REFRESH_MS)).toBeNull();
  });
});
