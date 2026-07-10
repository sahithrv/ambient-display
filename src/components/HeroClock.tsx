import type { HTMLAttributes } from "react";

export interface HeroClockProps extends HTMLAttributes<HTMLDivElement> {
  time?: string;
  meridiem?: string;
  dateLabel?: string;
  greeting?: string;
  name?: string;
  message?: string;
}

export function HeroClock({
  time = "07:43",
  meridiem = "PM",
  dateLabel = "Saturday, May 11",
  greeting = "Good evening",
  name = "Sahith",
  message = "Hope you had a productive day.",
  className = "",
  ...props
}: HeroClockProps) {
  return (
    <div {...props} className={`hero-clock ${className}`}>
      <div className="hero-clock__time-row">
        <time className="hero-clock__time">{time}</time>
        {meridiem ? <span className="hero-clock__meridiem">{meridiem}</span> : null}
      </div>
      <p className="hero-clock__date">{dateLabel}</p>
      <h1 className="hero-clock__greeting">
        {greeting}
        {name ? `, ${name}` : ""}
      </h1>
      {message ? <p className="hero-clock__message">{message}</p> : null}
    </div>
  );
}
