import type { HTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { CalendarDayDisplay, CalendarEventDisplay } from "./types";
import { GlassIsland } from "./glass/GlassIsland";

export interface CalendarCardProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  dateRange?: string;
  days?: CalendarDayDisplay[];
  /** `null` renders an honest empty-day state instead of a placeholder event. */
  event?: CalendarEventDisplay | null;
  onOpen?: () => void;
  onEventMore?: (event: CalendarEventDisplay) => void;
}

export function CalendarCard({
  title = "Calendar",
  dateRange = "This week",
  days = [],
  event = null,
  onOpen,
  onEventMore,
  className = "",
  ...props
}: CalendarCardProps) {
  return (
    <GlassIsland
      {...props}
      className={`calendar-card ${className}`}
      glow="soft"
      aria-label={event ? `${title}, next event ${event.title}` : `${title}, no events today`}
    >
      <header className="calendar-card__header">
        <div className="calendar-card__title">
          <Icon name="calendar" size={23} />
          <span>{title}</span>
        </div>
        {onOpen ? (
          <button
            type="button"
            className="calendar-card__range"
            onClick={onOpen}
            aria-label="Open calendar"
          >
            <span>{dateRange}</span>
            <Icon name="chevron-right" size={20} />
          </button>
        ) : (
          <span className="calendar-card__range calendar-card__range--static">
            <span>{dateRange}</span>
          </span>
        )}
      </header>
      {days.length > 0 ? (
        <div className="calendar-card__days" aria-label="Week dates">
          {days.map((day, index) => (
            <div
              key={`${day.weekday}-${day.day}-${index}`}
              className={`calendar-card__day${day.selected ? " is-selected" : ""}`}
            >
              <span className="calendar-card__weekday">{day.weekday}</span>
              <span className="calendar-card__date">{day.day}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="calendar-card__divider" />
      <div className="calendar-card__next-label">{event ? "Up next" : "Today"}</div>
      {event ? (
        <div className="calendar-card__event">
          <span
            className="calendar-card__event-accent"
            style={{ background: event.accent ?? "#85b9ff" }}
          />
          <div className="calendar-card__event-copy">
            <strong>{event.title}</strong>
            <span>{event.time}</span>
          </div>
          {onEventMore ? (
            <button
              type="button"
              className="icon-button icon-button--quiet calendar-card__event-more"
              aria-label={`More options for ${event.title}`}
              onClick={() => onEventMore(event)}
            >
              <Icon name="more" size={20} />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="calendar-card__empty">
          <strong>No events today</strong>
          <span>Local calendar is clear</span>
        </div>
      )}
    </GlassIsland>
  );
}
