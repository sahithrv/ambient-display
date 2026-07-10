import { toDate, type InstantLike } from "./date";
import type { DayPart, SceneKey, SceneLock, WeatherFamily, WeatherSnapshot } from "./types";

export interface SceneCandidate {
  weatherFamily: WeatherFamily;
  dayPart: DayPart;
}

export interface SceneHysteresisState {
  activeWeatherFamily?: WeatherFamily;
  pendingWeatherFamily?: WeatherFamily;
  pendingSince?: number;
  /** Set only after the native adapter has accepted the scene command. */
  lastIssuedSceneKey?: SceneKey;
}

export interface SceneHysteresisDecision {
  sceneKey: SceneKey;
  shouldIssue: boolean;
  weatherHeld: boolean;
  state: SceneHysteresisState;
}

export interface SceneHysteresisOptions {
  weatherHoldMs: number;
}

export const DEFAULT_SCENE_HYSTERESIS: SceneHysteresisOptions = {
  weatherHoldMs: 5 * 60_000,
};

/** Open-Meteo WMO Weather interpretation codes normalized for wallpaper choice. */
export function normalizeWmoCode(code: number | undefined | null): WeatherFamily {
  switch (code) {
    case 0:
    case 1:
    case 2:
      return "clear";
    case 3:
      return "cloudy";
    case 45:
    case 48:
      return "fog";
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
    case 80:
    case 81:
    case 82:
      return "rain";
    case 71:
    case 73:
    case 75:
    case 77:
    case 85:
    case 86:
      return "snow";
    case 95:
    case 96:
    case 99:
      return "storm";
    default:
      return "fallback";
  }
}

/**
 * Uses sunrise/sunset instants instead of hard-coded clock hours. Invalid or
 * unavailable solar data degrades cleanly to the weather provider's isDay bit.
 */
export function dayPartFor(
  now: InstantLike,
  sunrise: InstantLike | undefined,
  sunset: InstantLike | undefined,
  fallbackIsDay = false,
): DayPart {
  const nowDate = toDate(now);
  const sunriseDate = sunrise === undefined ? undefined : toDate(sunrise);
  const sunsetDate = sunset === undefined ? undefined : toDate(sunset);
  if (!nowDate || !sunriseDate || !sunsetDate || sunsetDate.getTime() <= sunriseDate.getTime()) {
    return fallbackIsDay ? "day" : "night";
  }

  const current = nowDate.getTime();
  const sunriseAt = sunriseDate.getTime();
  const sunsetAt = sunsetDate.getTime();
  const dawnStart = sunriseAt - 45 * 60_000;
  const dawnEnd = sunriseAt + 75 * 60_000;
  const sunsetStart = sunsetAt - 75 * 60_000;
  const sunsetEnd = sunsetAt + 45 * 60_000;

  if (current >= dawnStart && current <= dawnEnd) {
    return "dawn";
  }
  if (current >= sunsetStart && current <= sunsetEnd) {
    return "sunset";
  }
  if (current > dawnEnd && current < sunsetStart) {
    return "day";
  }
  return "night";
}

export function sceneKeyFor(weatherFamily: WeatherFamily, dayPart: DayPart): SceneKey {
  switch (weatherFamily) {
    case "clear":
      return `clear.${dayPart}`;
    case "cloudy":
      return dayPart === "night" || dayPart === "sunset" ? "cloudy.night" : "cloudy.day";
    case "rain":
      return dayPart === "night" || dayPart === "sunset" ? "rain.night" : "rain.day";
    case "storm":
      return "storm.any";
    case "fog":
      return "fog.any";
    case "snow":
      return "snow.any";
    case "fallback":
      return "fallback.any";
  }
}

export function selectWeatherScene(
  snapshot: WeatherSnapshot | undefined,
  now: InstantLike,
): SceneCandidate {
  if (!snapshot) {
    return { weatherFamily: "fallback", dayPart: "night" };
  }

  return {
    weatherFamily: normalizeWmoCode(snapshot.weatherCode),
    dayPart: dayPartFor(now, snapshot.sunrise, snapshot.sunset, snapshot.isDay),
  };
}

/**
 * Holds only changes in weather family. Day-part transitions are allowed
 * immediately, so sunrise/sunset never wait behind a short-lived rain reading.
 */
export function evaluateSceneHysteresis(
  state: SceneHysteresisState,
  desired: SceneCandidate,
  now: number,
  options: Partial<SceneHysteresisOptions> = {},
): SceneHysteresisDecision {
  const { weatherHoldMs } = { ...DEFAULT_SCENE_HYSTERESIS, ...options };
  let activeWeatherFamily = state.activeWeatherFamily;
  let pendingWeatherFamily = state.pendingWeatherFamily;
  let pendingSince = state.pendingSince;
  let weatherHeld = false;

  if (!activeWeatherFamily) {
    activeWeatherFamily = desired.weatherFamily;
    pendingWeatherFamily = undefined;
    pendingSince = undefined;
  } else if (activeWeatherFamily === desired.weatherFamily) {
    pendingWeatherFamily = undefined;
    pendingSince = undefined;
  } else if (
    pendingWeatherFamily === desired.weatherFamily &&
    pendingSince !== undefined &&
    now - pendingSince >= weatherHoldMs
  ) {
    activeWeatherFamily = desired.weatherFamily;
    pendingWeatherFamily = undefined;
    pendingSince = undefined;
  } else {
    if (pendingWeatherFamily !== desired.weatherFamily) {
      pendingWeatherFamily = desired.weatherFamily;
      pendingSince = now;
    }
    weatherHeld = true;
  }

  const sceneKey = sceneKeyFor(activeWeatherFamily, desired.dayPart);
  const nextState: SceneHysteresisState = {
    activeWeatherFamily,
    pendingWeatherFamily,
    pendingSince,
    lastIssuedSceneKey: state.lastIssuedSceneKey,
  };
  return {
    sceneKey,
    shouldIssue: sceneKey !== state.lastIssuedSceneKey,
    weatherHeld,
    state: nextState,
  };
}

/** Call only after the native adapter accepted the request; it suppresses duplicates. */
export function markSceneIssued(
  state: SceneHysteresisState,
  sceneKey: SceneKey,
): SceneHysteresisState {
  return { ...state, lastIssuedSceneKey: sceneKey };
}

export function shouldIssueSceneCommand(
  lastIssuedSceneKey: SceneKey | undefined,
  sceneKey: SceneKey,
): boolean {
  return lastIssuedSceneKey !== sceneKey;
}

export function resolveSceneLock(lock: SceneLock, automaticScene: SceneKey): SceneKey {
  return lock.mode === "locked" && lock.sceneKey ? lock.sceneKey : automaticScene;
}

export function isWeatherCacheStale(
  observedAt: InstantLike | undefined,
  now: InstantLike,
  maxAgeMs = 20 * 60_000,
): boolean {
  if (observedAt === undefined) {
    return true;
  }

  const observed = toDate(observedAt);
  const current = toDate(now);
  return !observed || !current || current.getTime() - observed.getTime() > maxAgeMs;
}
