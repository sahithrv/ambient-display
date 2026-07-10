import { describe, expect, it } from "vitest";

import { parseOpenMeteoSnapshot } from "./weatherProvider";

describe("Open-Meteo weather mapping", () => {
  it("maps the live humidity and wind readings requested from Open-Meteo", () => {
    const snapshot = parseOpenMeteoSnapshot(
      {
        current: {
          temperature_2m: 18.4,
          apparent_temperature: 17.9,
          relative_humidity_2m: 67,
          weather_code: 3,
          is_day: 1,
          wind_speed_10m: 13.6,
        },
        daily: {
          temperature_2m_max: [20.1],
          temperature_2m_min: [11.2],
          sunrise: ["2026-07-09T05:52"],
          sunset: ["2026-07-09T20:28"],
        },
      },
      "2026-07-09T18:00:00.000Z",
    );

    expect(snapshot).toMatchObject({
      observedAt: "2026-07-09T18:00:00.000Z",
      temperatureC: 18.4,
      humidityPercent: 67,
      windSpeedKph: 13.6,
    });
  });

  it("does not turn malformed humidity or wind values into display data", () => {
    const snapshot = parseOpenMeteoSnapshot({
      current: {
        temperature_2m: 18,
        apparent_temperature: 18,
        relative_humidity_2m: 101,
        weather_code: 0,
        is_day: 1,
        wind_speed_10m: -2,
      },
      daily: {
        temperature_2m_max: [20],
        temperature_2m_min: [10],
        sunrise: ["2026-07-09T05:52"],
        sunset: ["2026-07-09T20:28"],
      },
    });

    expect(snapshot).toMatchObject({ humidityPercent: undefined, windSpeedKph: undefined });
  });
});
