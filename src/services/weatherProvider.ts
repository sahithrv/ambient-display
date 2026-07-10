import type { WeatherSnapshot } from "../domain/types";
import type { DataProvider, WeatherLocation } from "./types";
import type { ProviderStatus } from "../domain/types";

// v2 adds the live humidity and wind fields. Keeping it separate prevents an
// older cache entry from being rendered with made-up environmental values.
const CACHE_PREFIX = "ambient-glass.weather.v2";
const FIFTEEN_MINUTES = 15 * 60 * 1_000;

export class OpenMeteoWeatherProvider implements DataProvider<WeatherSnapshot> {
  private cached: WeatherSnapshot | null;
  private status: ProviderStatus;

  public constructor(private readonly location: WeatherLocation) {
    this.cached = readCache(location);
    this.status = this.cached
      ? { state: "stale", lastUpdated: this.cached.observedAt, message: "Using cached weather" }
      : { state: "loading" };
  }

  public getStatus(): ProviderStatus {
    return this.status;
  }

  public getCached(): WeatherSnapshot | null {
    return this.cached;
  }

  public async refresh(): Promise<WeatherSnapshot | null> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.status = this.cached
        ? {
            state: "offline",
            lastUpdated: this.cached.observedAt,
            message: "Offline — cached weather",
          }
        : { state: "offline", message: "Offline — no weather yet" };
      return this.cached;
    }

    this.status = { state: "loading", lastUpdated: this.cached?.observedAt };
    const params = new URLSearchParams({
      latitude: String(this.location.latitude),
      longitude: String(this.location.longitude),
      current:
        "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset",
      timezone: this.location.timezone ?? "auto",
      wind_speed_unit: "kmh",
      forecast_days: "1",
    });

    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new Error(`Weather request failed (${response.status})`);
      }
      const payload: unknown = await response.json();
      const snapshot = parseOpenMeteoSnapshot(payload);
      if (!snapshot) {
        throw new Error("Weather payload did not contain expected values");
      }
      this.cached = snapshot;
      this.status = { state: "ready", lastUpdated: snapshot.observedAt };
      writeCache(this.location, snapshot);
      return snapshot;
    } catch {
      this.status = this.cached
        ? {
            state: "stale",
            lastUpdated: this.cached.observedAt,
            message: "Weather unavailable — cached",
          }
        : { state: "error", message: "Weather unavailable" };
      return this.cached;
    }
  }

  public isFresh(now = Date.now()): boolean {
    return Boolean(this.cached && now - Date.parse(this.cached.observedAt) < FIFTEEN_MINUTES);
  }
}

/**
 * Parses only the fields Ambient Glass displays. This deliberately leaves
 * absent weather readings undefined so the UI can omit them instead of
 * substituting a design-time value for live data.
 */
export function parseOpenMeteoSnapshot(
  value: unknown,
  observedAt = new Date().toISOString(),
): WeatherSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const data = value as {
    current?: Record<string, unknown>;
    daily?: Record<string, unknown>;
  };
  const current = data.current;
  const daily = data.daily;
  if (!current || !daily) {
    return null;
  }
  const number = (entry: unknown): number | undefined =>
    typeof entry === "number" && Number.isFinite(entry) ? entry : undefined;
  const first = (entry: unknown): unknown => (Array.isArray(entry) ? entry[0] : undefined);
  const date = (entry: unknown): string | undefined =>
    typeof entry === "string" ? entry : undefined;

  const humidityPercent = number(current.relative_humidity_2m);
  const windSpeedKph = number(current.wind_speed_10m);

  return {
    observedAt,
    weatherCode: number(current.weather_code),
    temperatureC: number(current.temperature_2m),
    apparentTemperatureC: number(current.apparent_temperature),
    humidityPercent:
      humidityPercent !== undefined && humidityPercent >= 0 && humidityPercent <= 100
        ? humidityPercent
        : undefined,
    windSpeedKph: windSpeedKph !== undefined && windSpeedKph >= 0 ? windSpeedKph : undefined,
    highC: number(first(daily.temperature_2m_max)),
    lowC: number(first(daily.temperature_2m_min)),
    sunrise: date(first(daily.sunrise)),
    sunset: date(first(daily.sunset)),
    isDay: current.is_day === 1,
  };
}

function cacheKey(location: WeatherLocation): string {
  return `${CACHE_PREFIX}:${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
}

function readCache(location: WeatherLocation): WeatherSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(cacheKey(location));
    return raw ? (JSON.parse(raw) as WeatherSnapshot) : null;
  } catch {
    return null;
  }
}

function writeCache(location: WeatherLocation, snapshot: WeatherSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(cacheKey(location), JSON.stringify(snapshot));
}
