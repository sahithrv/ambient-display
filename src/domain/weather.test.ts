import { describe, expect, it } from "vitest";

import {
  dayPartFor,
  evaluateSceneHysteresis,
  isWeatherCacheStale,
  markSceneIssued,
  normalizeWmoCode,
  sceneKeyFor,
} from "./weather";

describe("weather scene selection", () => {
  it("normalizes Open-Meteo WMO codes into the intended scene families", () => {
    expect(normalizeWmoCode(0)).toBe("clear");
    expect(normalizeWmoCode(3)).toBe("cloudy");
    expect(normalizeWmoCode(45)).toBe("fog");
    expect(normalizeWmoCode(63)).toBe("rain");
    expect(normalizeWmoCode(75)).toBe("snow");
    expect(normalizeWmoCode(96)).toBe("storm");
    expect(normalizeWmoCode(999)).toBe("fallback");
  });

  it("uses sunrise and sunset boundary windows rather than fixed hours", () => {
    const sunrise = "2026-07-09T06:00:00.000Z";
    const sunset = "2026-07-09T18:00:00.000Z";

    expect(dayPartFor("2026-07-09T05:15:00.000Z", sunrise, sunset)).toBe("dawn");
    expect(dayPartFor("2026-07-09T07:15:00.000Z", sunrise, sunset)).toBe("dawn");
    expect(dayPartFor("2026-07-09T07:16:00.000Z", sunrise, sunset)).toBe("day");
    expect(dayPartFor("2026-07-09T16:45:00.000Z", sunrise, sunset)).toBe("sunset");
    expect(dayPartFor("2026-07-09T18:46:00.000Z", sunrise, sunset)).toBe("night");
    expect(sceneKeyFor("clear", "sunset")).toBe("clear.sunset");
    expect(sceneKeyFor("rain", "sunset")).toBe("rain.night");
  });

  it("holds fluctuating weather but immediately allows a day-part scene change", () => {
    const initial = evaluateSceneHysteresis({}, { weatherFamily: "clear", dayPart: "day" }, 0);
    expect(initial).toMatchObject({ sceneKey: "clear.day", shouldIssue: true, weatherHeld: false });

    const issued = markSceneIssued(initial.state, initial.sceneKey);
    const rainCandidate = evaluateSceneHysteresis(
      issued,
      { weatherFamily: "rain", dayPart: "day" },
      1_000,
    );
    expect(rainCandidate).toMatchObject({
      sceneKey: "clear.day",
      shouldIssue: false,
      weatherHeld: true,
    });

    const sunsetDuringHold = evaluateSceneHysteresis(
      rainCandidate.state,
      { weatherFamily: "rain", dayPart: "sunset" },
      2_000,
    );
    expect(sunsetDuringHold).toMatchObject({
      sceneKey: "clear.sunset",
      shouldIssue: true,
      weatherHeld: true,
    });

    const acceptedRain = evaluateSceneHysteresis(
      sunsetDuringHold.state,
      { weatherFamily: "rain", dayPart: "night" },
      301_000,
    );
    expect(acceptedRain).toMatchObject({ sceneKey: "rain.night", weatherHeld: false });
  });

  it("marks caches stale without throwing when data is missing", () => {
    expect(isWeatherCacheStale(undefined, "2026-07-09T12:00:00.000Z")).toBe(true);
    expect(
      isWeatherCacheStale("2026-07-09T11:50:00.000Z", "2026-07-09T12:00:00.000Z", 20 * 60_000),
    ).toBe(false);
  });
});
