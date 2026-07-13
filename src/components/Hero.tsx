import type { HTMLAttributes } from "react";
import { HeroClock } from "./HeroClock";
import { WeatherCapsule } from "./WeatherCapsule";
import type { WeatherDisplayData } from "./types";
import { GlassIsland } from "./glass/GlassIsland";

export interface HeroProps extends HTMLAttributes<HTMLElement> {
  weather?: WeatherDisplayData;
  time?: string;
  meridiem?: string;
  dateLabel?: string;
  greeting?: string;
  name?: string;
  message?: string;
}

/** The main merged clock/weather island. It stays intentionally sparse. */
export function Hero({
  weather,
  time,
  meridiem,
  dateLabel,
  greeting,
  name,
  message,
  className = "",
  ...props
}: HeroProps) {
  return (
    <section
      {...props}
      className={`hero${weather?.available === false ? " hero--weather-unavailable" : ""} ${className}`}
      aria-label="Current time and weather"
    >
      <GlassIsland className="hero__island" glow="soft" variant="organic">
        <div className="hero__layout">
          <HeroClock
            time={time}
            meridiem={meridiem}
            dateLabel={dateLabel}
            greeting={greeting}
            name={name}
            message={message}
          />
          <WeatherCapsule className="hero__weather" embedded weather={weather} />
        </div>
      </GlassIsland>
    </section>
  );
}
