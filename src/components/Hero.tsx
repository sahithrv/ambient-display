import type { HTMLAttributes } from "react";
import { HeroClock } from "./HeroClock";
import { WeatherCapsule } from "./WeatherCapsule";
import type { WeatherDisplayData } from "./types";
import { GlassIsland } from "./glass/GlassIsland";
import { LiquidEdge } from "./glass/LiquidEdge";

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
    <section {...props} className={`hero ${className}`} aria-label="Current time and weather">
      <GlassIsland
        className="hero__clock-island"
        variant="organic"
        glow="bright"
        radius="37% 27% 34% 28% / 29% 41% 37% 43%"
      >
        <HeroClock
          time={time}
          meridiem={meridiem}
          dateLabel={dateLabel}
          greeting={greeting}
          name={name}
          message={message}
        />
      </GlassIsland>
      <LiquidEdge className="hero__merge-edge" />
      <WeatherCapsule weather={weather} />
    </section>
  );
}
