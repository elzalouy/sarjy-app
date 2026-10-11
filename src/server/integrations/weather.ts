import "server-only";

const WEATHER_PATH = "/data/2.5/weather";
const WEATHER_TIMEOUT_MS = 5_000;
const LOCATION_MAX_LENGTH = 80;

export type WeatherReport = {
  location: string;
  condition: string;
  temperatureC: number;
  humidityPercent: number;
  observedAt: string;
};

export type WeatherQuery =
  | { kind: "city"; name: string }
  | { kind: "coordinates"; latitude: number; longitude: number };

export class WeatherLocationError extends Error {
  constructor() {
    super("Enter a city name or coordinates.");
    this.name = "WeatherLocationError";
  }
}

export class WeatherNotFoundError extends Error {
  constructor() {
    super("That location was not found.");
    this.name = "WeatherNotFoundError";
  }
}

export class WeatherUnavailableError extends Error {
  constructor() {
    super("Weather is unavailable.");
    this.name = "WeatherUnavailableError";
  }
}

export function readWeatherQuery(input: unknown): WeatherQuery {
  if (typeof input !== "string") {
    throw new WeatherLocationError();
  }
  const text = input.trim().replace(/\s+/g, " ");
  if (text.length === 0 || text.length > LOCATION_MAX_LENGTH) {
    throw new WeatherLocationError();
  }
  if (/[:/?#\\@]|[\u0000-\u001f\u007f]/.test(text)) {
    throw new WeatherLocationError();
  }
  const coordinates = readCoordinates(text);
  if (coordinates !== null) {
    return coordinates;
  }
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s,.'-]{0,79}$/u.test(text)) {
    throw new WeatherLocationError();
  }
  return { kind: "city", name: text };
}

export async function fetchOpenWeather(input: {
  baseUrl: string;
  apiKey: string;
  location: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<WeatherReport> {
  if (input.apiKey.length === 0) {
    throw new WeatherUnavailableError();
  }
  const query = readWeatherQuery(input.location);
  const url = weatherUrl(input.baseUrl, input.apiKey, query);
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs ?? WEATHER_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch {
    throw new WeatherUnavailableError();
  }
  if (response.status === 404) {
    throw new WeatherNotFoundError();
  }
  if (!response.ok) {
    throw new WeatherUnavailableError();
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WeatherUnavailableError();
  }
  if (isNotFoundPayload(payload)) {
    throw new WeatherNotFoundError();
  }
  return normalizeReport(payload);
}

function weatherUrl(baseUrl: string, apiKey: string, query: WeatherQuery): URL {
  let origin = "";
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new WeatherUnavailableError();
    }
    origin = parsed.origin;
  } catch (error) {
    if (error instanceof WeatherUnavailableError) {
      throw error;
    }
    throw new WeatherUnavailableError();
  }
  const url = new URL(WEATHER_PATH, origin);
  url.searchParams.set("units", "metric");
  url.searchParams.set("appid", apiKey);
  if (query.kind === "city") {
    url.searchParams.set("q", query.name);
    return url;
  }
  url.searchParams.set("lat", trimCoordinate(query.latitude));
  url.searchParams.set("lon", trimCoordinate(query.longitude));
  return url;
}

function readCoordinates(text: string): WeatherQuery | null {
  const match = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  if (match === null) {
    return null;
  }
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new WeatherLocationError();
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new WeatherLocationError();
  }
  return { kind: "coordinates", latitude, longitude };
}

function trimCoordinate(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

function normalizeReport(payload: unknown): WeatherReport {
  if (!isRecord(payload) || !isRecord(payload.main)) {
    throw new WeatherUnavailableError();
  }
  const temperature = payload.main.temp;
  const humidity = payload.main.humidity;
  const name = payload.name;
  const condition = Array.isArray(payload.weather)
    ? payload.weather[0]
    : undefined;
  const description =
    isRecord(condition) && typeof condition.description === "string"
      ? condition.description.trim()
      : "";
  const country =
    isRecord(payload.sys) && typeof payload.sys.country === "string"
      ? payload.sys.country.trim()
      : "";
  const observed = payload.dt;
  if (
    typeof temperature !== "number" ||
    !Number.isFinite(temperature) ||
    typeof humidity !== "number" ||
    !Number.isFinite(humidity) ||
    humidity < 0 ||
    humidity > 100 ||
    typeof name !== "string" ||
    name.trim().length === 0 ||
    description.length === 0 ||
    typeof observed !== "number" ||
    !Number.isFinite(observed)
  ) {
    throw new WeatherUnavailableError();
  }
  const place = name.trim();
  const location = country.length > 0 ? `${place}, ${country}` : place;
  return {
    location,
    condition: description,
    temperatureC: Math.round(temperature * 10) / 10,
    humidityPercent: Math.round(humidity),
    observedAt: new Date(observed * 1000).toISOString(),
  };
}

function isNotFoundPayload(payload: unknown): boolean {
  return isRecord(payload) && (payload.cod === 404 || payload.cod === "404");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
