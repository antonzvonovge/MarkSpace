/** Current conditions from Open-Meteo. No API key. */

import { z } from "zod";
import { isNativeLanguageId, type NativeLanguageId } from "../settings/types";

export const WEATHER_REFRESH_MS = 15 * 60 * 1000;

export type WeatherPlace = {
  name: string;
  admin: string;
  country: string;
  latitude: number;
  longitude: number;
};

export type WeatherIconKind =
  | "clear-day"
  | "clear-night"
  | "partly-day"
  | "partly-night"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm";

export type CurrentWeather = {
  temperature: number;
  temperatureUnit: string;
  humidity: number;
  wind: number;
  windUnit: string;
  code: number;
  isDay: boolean;
};

const geocodingSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        admin1: z.string().optional(),
        country: z.string().optional(),
        latitude: z.number(),
        longitude: z.number(),
      }),
    )
    .optional(),
});

const currentSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    relative_humidity_2m: z.number(),
    weather_code: z.number().int(),
    wind_speed_10m: z.number(),
    is_day: z.number(),
  }),
  current_units: z
    .object({
      temperature_2m: z.string().optional(),
      wind_speed_10m: z.string().optional(),
    })
    .optional(),
});

export function formatPlace(place: {
  name: string;
  admin?: string;
  country?: string;
}): string {
  const parts = [place.name];
  if (place.admin && place.admin !== place.name) parts.push(place.admin);
  if (place.country) parts.push(place.country);
  return parts.join(", ");
}

export type WeatherPhrase =
  | "clear"
  | "mainlyClear"
  | "partly"
  | "overcast"
  | "fog"
  | "drizzle"
  | "freezingDrizzle"
  | "rain"
  | "freezingRain"
  | "snow"
  | "rainShowers"
  | "snowShowers"
  | "storm"
  | "unknown";

type WeatherCopy = Record<WeatherPhrase, string> & {
  humidity: string;
  wind: string;
  /** Shown when the API unit is km/h. */
  kmh: string;
};

const WEATHER_COPY: Record<NativeLanguageId, WeatherCopy> = {
  en: {
    clear: "Clear",
    mainlyClear: "Mainly clear",
    partly: "Partly cloudy",
    overcast: "Overcast",
    fog: "Fog",
    drizzle: "Drizzle",
    freezingDrizzle: "Freezing drizzle",
    rain: "Rain",
    freezingRain: "Freezing rain",
    snow: "Snow",
    rainShowers: "Rain showers",
    snowShowers: "Snow showers",
    storm: "Thunderstorm",
    unknown: "Weather",
    humidity: "Humidity",
    wind: "Wind",
    kmh: "km/h",
  },
  ru: {
    clear: "Ясно",
    mainlyClear: "Малооблачно",
    partly: "Переменная облачность",
    overcast: "Пасмурно",
    fog: "Туман",
    drizzle: "Морось",
    freezingDrizzle: "Ледяная морось",
    rain: "Дождь",
    freezingRain: "Ледяной дождь",
    snow: "Снег",
    rainShowers: "Ливни",
    snowShowers: "Снегопад",
    storm: "Гроза",
    unknown: "Погода",
    humidity: "Влажность",
    wind: "Ветер",
    kmh: "км/ч",
  },
  uk: {
    clear: "Ясно",
    mainlyClear: "Невелика хмарність",
    partly: "Мінлива хмарність",
    overcast: "Хмарно",
    fog: "Туман",
    drizzle: "Мряка",
    freezingDrizzle: "Крижана мряка",
    rain: "Дощ",
    freezingRain: "Крижаний дощ",
    snow: "Сніг",
    rainShowers: "Зливи",
    snowShowers: "Снігопад",
    storm: "Гроза",
    unknown: "Погода",
    humidity: "Вологість",
    wind: "Вітер",
    kmh: "км/год",
  },
  de: {
    clear: "Klar",
    mainlyClear: "Überwiegend klar",
    partly: "Teilweise bewölkt",
    overcast: "Bedeckt",
    fog: "Nebel",
    drizzle: "Nieselregen",
    freezingDrizzle: "Gefrierender Nieselregen",
    rain: "Regen",
    freezingRain: "Gefrierender Regen",
    snow: "Schnee",
    rainShowers: "Regenschauer",
    snowShowers: "Schneeschauer",
    storm: "Gewitter",
    unknown: "Wetter",
    humidity: "Feuchte",
    wind: "Wind",
    kmh: "km/h",
  },
  fr: {
    clear: "Clair",
    mainlyClear: "Peu nuageux",
    partly: "Partiellement nuageux",
    overcast: "Couvert",
    fog: "Brouillard",
    drizzle: "Bruine",
    freezingDrizzle: "Bruine verglaçante",
    rain: "Pluie",
    freezingRain: "Pluie verglaçante",
    snow: "Neige",
    rainShowers: "Averses",
    snowShowers: "Averses de neige",
    storm: "Orage",
    unknown: "Météo",
    humidity: "Humidité",
    wind: "Vent",
    kmh: "km/h",
  },
  es: {
    clear: "Despejado",
    mainlyClear: "Mayormente despejado",
    partly: "Parcialmente nublado",
    overcast: "Nublado",
    fog: "Niebla",
    drizzle: "Llovizna",
    freezingDrizzle: "Llovizna helada",
    rain: "Lluvia",
    freezingRain: "Lluvia helada",
    snow: "Nieve",
    rainShowers: "Chubascos",
    snowShowers: "Chubascos de nieve",
    storm: "Tormenta",
    unknown: "Tiempo",
    humidity: "Humedad",
    wind: "Viento",
    kmh: "km/h",
  },
  it: {
    clear: "Sereno",
    mainlyClear: "Poco nuvoloso",
    partly: "Parzialmente nuvoloso",
    overcast: "Coperto",
    fog: "Nebbia",
    drizzle: "Pioggerella",
    freezingDrizzle: "Pioggerella gelata",
    rain: "Pioggia",
    freezingRain: "Pioggia gelata",
    snow: "Neve",
    rainShowers: "Rovesci",
    snowShowers: "Rovesci di neve",
    storm: "Temporale",
    unknown: "Meteo",
    humidity: "Umidità",
    wind: "Vento",
    kmh: "km/h",
  },
  pt: {
    clear: "Limpo",
    mainlyClear: "Pouco nublado",
    partly: "Parcialmente nublado",
    overcast: "Encoberto",
    fog: "Nevoeiro",
    drizzle: "Chuvisco",
    freezingDrizzle: "Chuvisco gelado",
    rain: "Chuva",
    freezingRain: "Chuva gelada",
    snow: "Neve",
    rainShowers: "Aguaceiros",
    snowShowers: "Aguaceiros de neve",
    storm: "Trovoada",
    unknown: "Tempo",
    humidity: "Humidade",
    wind: "Vento",
    kmh: "km/h",
  },
  pl: {
    clear: "Bezchmurnie",
    mainlyClear: "Przeważnie bezchmurnie",
    partly: "Częściowe zachmurzenie",
    overcast: "Pochmurno",
    fog: "Mgła",
    drizzle: "Mżawka",
    freezingDrizzle: "Marznąca mżawka",
    rain: "Deszcz",
    freezingRain: "Marznący deszcz",
    snow: "Śnieg",
    rainShowers: "Przelotne deszcze",
    snowShowers: "Przelotny śnieg",
    storm: "Burza",
    unknown: "Pogoda",
    humidity: "Wilgotność",
    wind: "Wiatr",
    kmh: "km/h",
  },
  ka: {
    clear: "მოწმენდილი",
    mainlyClear: "უმეტესად მოწმენდილი",
    partly: "ნაწილობრივ ღრუბლიანი",
    overcast: "მოღრუბლული",
    fog: "ნისლი",
    drizzle: "ჟინჟლი",
    freezingDrizzle: "მყინვარე ჟინჟლი",
    rain: "წვიმა",
    freezingRain: "მყინვარე წვიმა",
    snow: "თოვლი",
    rainShowers: "თავსხმა წვიმა",
    snowShowers: "თოვა",
    storm: "ჭექა-ქუხილი",
    unknown: "ამინდი",
    humidity: "ტენიანობა",
    wind: "ქარი",
    kmh: "კმ/სთ",
  },
  zh: {
    clear: "晴",
    mainlyClear: "大部晴朗",
    partly: "多云",
    overcast: "阴",
    fog: "雾",
    drizzle: "毛毛雨",
    freezingDrizzle: "冻毛毛雨",
    rain: "雨",
    freezingRain: "冻雨",
    snow: "雪",
    rainShowers: "阵雨",
    snowShowers: "阵雪",
    storm: "雷暴",
    unknown: "天气",
    humidity: "湿度",
    wind: "风",
    kmh: "公里/时",
  },
  ja: {
    clear: "快晴",
    mainlyClear: "ほぼ晴れ",
    partly: "曇りがち",
    overcast: "本曇り",
    fog: "霧",
    drizzle: "霧雨",
    freezingDrizzle: "着氷性の霧雨",
    rain: "雨",
    freezingRain: "着氷性の雨",
    snow: "雪",
    rainShowers: "にわか雨",
    snowShowers: "にわか雪",
    storm: "雷雨",
    unknown: "天気",
    humidity: "湿度",
    wind: "風",
    kmh: "km/h",
  },
  ko: {
    clear: "맑음",
    mainlyClear: "대체로 맑음",
    partly: "구름 조금",
    overcast: "흐림",
    fog: "안개",
    drizzle: "이슬비",
    freezingDrizzle: "얼어붙는 이슬비",
    rain: "비",
    freezingRain: "얼어붙는 비",
    snow: "눈",
    rainShowers: "소나기",
    snowShowers: "소낙눈",
    storm: "뇌우",
    unknown: "날씨",
    humidity: "습도",
    wind: "바람",
    kmh: "km/h",
  },
};

function weatherCopy(language: string): WeatherCopy {
  return isNativeLanguageId(language) ? WEATHER_COPY[language] : WEATHER_COPY.en;
}

export function weatherPresentation(
  code: number,
  isDay: boolean,
): { kind: WeatherIconKind; phrase: WeatherPhrase } {
  switch (code) {
    case 0:
      return { kind: isDay ? "clear-day" : "clear-night", phrase: "clear" };
    case 1:
      return { kind: isDay ? "partly-day" : "partly-night", phrase: "mainlyClear" };
    case 2:
      return { kind: isDay ? "partly-day" : "partly-night", phrase: "partly" };
    case 3:
      return { kind: "cloudy", phrase: "overcast" };
    case 45:
    case 48:
      return { kind: "fog", phrase: "fog" };
    case 51:
    case 53:
    case 55:
      return { kind: "drizzle", phrase: "drizzle" };
    case 56:
    case 57:
      return { kind: "drizzle", phrase: "freezingDrizzle" };
    case 61:
    case 63:
    case 65:
      return { kind: "rain", phrase: "rain" };
    case 66:
    case 67:
      return { kind: "rain", phrase: "freezingRain" };
    case 71:
    case 73:
    case 75:
    case 77:
      return { kind: "snow", phrase: "snow" };
    case 80:
    case 81:
    case 82:
      return { kind: "rain", phrase: "rainShowers" };
    case 85:
    case 86:
      return { kind: "snow", phrase: "snowShowers" };
    case 95:
    case 96:
    case 99:
      return { kind: "storm", phrase: "storm" };
    default:
      return { kind: "cloudy", phrase: "unknown" };
  }
}

export function weatherPhrase(phrase: WeatherPhrase, language: string): string {
  return weatherCopy(language)[phrase];
}

export function weatherDetail(
  kind: "humidity" | "wind",
  value: number,
  language: string,
  windUnit = "km/h",
): string {
  const copy = weatherCopy(language);
  const rounded = Math.round(value);
  if (kind === "humidity") return `${copy.humidity} ${rounded}%`;
  const unit = windUnit === "km/h" ? copy.kmh : windUnit;
  return `${copy.wind} ${rounded} ${unit}`;
}

export function parseCitySearch(data: unknown): WeatherPlace[] {
  const parsed = geocodingSchema.safeParse(data);
  if (!parsed.success) return [];
  const places: WeatherPlace[] = [];
  for (const row of parsed.data.results ?? []) {
    if (row.latitude < -90 || row.latitude > 90) continue;
    if (row.longitude < -180 || row.longitude > 180) continue;
    places.push({
      name: row.name,
      admin: row.admin1?.trim() ?? "",
      country: row.country?.trim() ?? "",
      latitude: row.latitude,
      longitude: row.longitude,
    });
  }
  return places;
}

export function parseCurrentWeather(data: unknown): CurrentWeather | null {
  const parsed = currentSchema.safeParse(data);
  if (!parsed.success) return null;
  const current = parsed.data.current;
  return {
    temperature: current.temperature_2m,
    temperatureUnit: parsed.data.current_units?.temperature_2m || "°C",
    humidity: current.relative_humidity_2m,
    wind: current.wind_speed_10m,
    windUnit: parsed.data.current_units?.wind_speed_10m || "km/h",
    code: current.weather_code,
    isDay: current.is_day !== 0,
  };
}

const weatherCache = new Map<string, { at: number; weather: CurrentWeather }>();

export function weatherCacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

export function rememberWeather(
  latitude: number,
  longitude: number,
  weather: CurrentWeather,
  at = Date.now(),
): void {
  weatherCache.set(weatherCacheKey(latitude, longitude), { at, weather });
}

export function cachedWeather(
  latitude: number,
  longitude: number,
  now = Date.now(),
): CurrentWeather | null {
  const hit = weatherCache.get(weatherCacheKey(latitude, longitude));
  if (!hit || now - hit.at > WEATHER_REFRESH_MS) return null;
  return hit.weather;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export async function searchCities(
  query: string,
  signal?: AbortSignal,
): Promise<WeatherPlace[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("Could not search cities");
  return parseCitySearch(await res.json());
}

export async function fetchCurrentWeather(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<CurrentWeather> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
  );
  url.searchParams.set("timezone", "auto");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("Could not load weather");
  const weather = parseCurrentWeather(await res.json());
  if (!weather) throw new Error("Could not load weather");
  rememberWeather(latitude, longitude, weather);
  return weather;
}

export function ignoreAbort(err: unknown): boolean {
  return isAbort(err);
}
