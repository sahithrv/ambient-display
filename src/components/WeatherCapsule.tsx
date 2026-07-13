import type { HTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { WeatherCondition, WeatherDisplayData } from "./types";
import { DEFAULT_WEATHER } from "./types";
import { GlassIsland } from "./glass/GlassIsland";

export interface WeatherCapsuleProps extends HTMLAttributes<HTMLElement> {
  weather?: WeatherDisplayData;
  /** Renders only the weather content for use inside another glass surface. */
  embedded?: boolean;
}

function WeatherGlyph({ kind = "partly-cloudy" }: { kind?: WeatherCondition }) {
  if (kind === "rain" || kind === "storm") {
    return (
      <svg className="weather-capsule__glyph" viewBox="0 0 150 100" aria-hidden="true">
        <defs>
          <filter id="weather-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <linearGradient id="cloud-fill" x1="0" x2="1">
            <stop stopColor="#dce7ff" />
            <stop offset="1" stopColor="#7b90cc" />
          </linearGradient>
        </defs>
        <path
          d="M31 67c-11 0-18-7-18-17 0-11 9-19 20-19 6-15 29-21 43-7 14-11 38-3 40 16 13 0 22 7 22 17 0 10-9 17-20 17H31Z"
          fill="url(#cloud-fill)"
          opacity=".9"
          filter="url(#weather-glow)"
        />
        {kind === "storm" ? (
          <path d="m76 64-10 22 17-18-7 23 17-25H82l8-18Z" fill="#dceaff" />
        ) : (
          <path
            d="m54 73-4 10m19-10-4 10m19-10-4 10"
            stroke="#aec9ff"
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}
      </svg>
    );
  }

  if (kind === "clear") {
    return (
      <svg className="weather-capsule__glyph" viewBox="0 0 150 100" aria-hidden="true">
        <defs>
          <filter id="sun-glow">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <circle cx="83" cy="48" r="26" fill="#d9e8ff" opacity=".34" filter="url(#sun-glow)" />
        <circle cx="83" cy="48" r="20" fill="#e5edff" />
        <g stroke="#e5edff" strokeWidth="3" strokeLinecap="round">
          <path d="M83 14v-7M83 89v-7M49 48h-7M124 48h-7M59 24l-5-5M108 76l5 5M108 24l5-5M59 76l-5 5" />
        </g>
      </svg>
    );
  }

  if (kind === "snow") {
    return (
      <svg className="weather-capsule__glyph" viewBox="0 0 150 100" aria-hidden="true">
        <path
          d="M31 65c-11 0-18-7-18-17 0-11 9-19 20-19 6-15 29-21 43-7 14-11 38-3 40 16 13 0 22 7 22 17 0 10-9 17-20 17H31Z"
          fill="#dbe8ff"
          opacity=".85"
        />
        <g stroke="#dceaff" strokeWidth="2.5" strokeLinecap="round">
          <path d="M50 75v14m-6-10 12 6m0-6-12 6M76 75v14m-6-10 12 6m0-6-12 6M102 75v14m-6-10 12 6m0-6-12 6" />
        </g>
      </svg>
    );
  }

  return (
    <svg className="weather-capsule__glyph" viewBox="0 0 150 100" aria-hidden="true">
      <defs>
        <filter id="moon-glow">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <linearGradient id="weather-cloud" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#e7efff" />
          <stop offset="1" stopColor="#7186bf" />
        </linearGradient>
      </defs>
      <path
        d="M94 11a34 34 0 0 1-29 49 34 34 0 0 1-16-4c10 16 34 22 51 10 18-12 21-37 8-53a34 34 0 0 1-14-2Z"
        fill="#dbe8ff"
        opacity=".36"
        filter="url(#moon-glow)"
      />
      <path
        d="M91 13a30 30 0 0 1-25 43 30 30 0 0 1-15-4c10 14 30 19 45 9 15-11 18-32 8-47-4 0-9 0-13-1Z"
        fill="#dce9ff"
        opacity=".93"
      />
      <path
        d="M39 75c-11 0-19-7-19-17 0-11 9-20 21-20 7-17 31-23 47-7 14-10 38-2 41 17 13 0 22 7 22 17 0 11-9 19-21 19H39Z"
        fill="url(#weather-cloud)"
        opacity=".85"
        filter="url(#moon-glow)"
      />
      <path
        d="M39 75c-11 0-19-7-19-17 0-11 9-20 21-20 7-17 31-23 47-7 14-10 38-2 41 17 13 0 22 7 22 17 0 11-9 19-21 19H39Z"
        fill="url(#weather-cloud)"
        opacity=".8"
      />
    </svg>
  );
}

export function WeatherCapsule({
  weather = DEFAULT_WEATHER,
  embedded = false,
  className = "",
  ...props
}: WeatherCapsuleProps) {
  if (weather.available === false) {
    const unavailableContent = (
      <>
        <span className="weather-capsule__unavailable-icon" aria-hidden="true">
          <Icon name="cloud-moon" size={24} />
        </span>
        <div className="weather-capsule__unavailable-copy">
          <strong>Weather unavailable</strong>
          <span>Check your location in Settings</span>
        </div>
      </>
    );

    if (embedded) {
      return (
        <section
          {...props}
          className={`weather-capsule weather-capsule--embedded weather-capsule--unavailable ${className}`}
          aria-label="Weather unavailable"
        >
          {unavailableContent}
        </section>
      );
    }

    return (
      <GlassIsland
        {...props}
        className={`weather-capsule weather-capsule--unavailable ${className}`}
        glow="none"
        radius="36px"
        aria-label="Weather unavailable"
      >
        {unavailableContent}
      </GlassIsland>
    );
  }

  const weatherContent = (
    <>
      <div className="weather-capsule__reading">
        <span className="weather-capsule__temperature">{weather.temperature}°</span>
        <span className="weather-capsule__condition">{weather.condition}</span>
      </div>
      <WeatherGlyph kind={weather.kind} />
      <div className="weather-capsule__stats">
        {weather.wind ? (
          <span>
            <Icon name="wind" size={17} />
            {weather.wind}
          </span>
        ) : null}
        {weather.humidity ? (
          <span>
            <Icon name="droplet" size={16} />
            {weather.humidity}
          </span>
        ) : null}
      </div>
    </>
  );

  if (embedded) {
    return (
      <section
        {...props}
        className={`weather-capsule weather-capsule--embedded ${className}`}
        aria-label={`Weather: ${weather.temperature} degrees, ${weather.condition}`}
      >
        {weatherContent}
      </section>
    );
  }

  return (
    <GlassIsland
      {...props}
      className={`weather-capsule ${className}`}
      glow="none"
      radius="36px"
      aria-label={`Weather: ${weather.temperature} degrees, ${weather.condition}`}
    >
      {weatherContent}
    </GlassIsland>
  );
}
