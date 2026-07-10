import {
  addCalendarDays,
  dayOfWeekForDate,
  isLocalDate,
  localDateKey,
  localDayBounds,
  toDate,
} from "./date";
import type { CalendarEvent, LocalDate } from "./types";

/**
 * Keeps only events which intersect a local calendar day. Timed events crossing
 * midnight are included on both affected days; all-day `endsAt` follows the
 * common exclusive-end convention used by Google Calendar.
 */
export function calendarEventsForDate(
  events: CalendarEvent[],
  date: LocalDate,
  timeZone?: string,
): CalendarEvent[] {
  return events
    .filter((event) => calendarEventIntersectsDate(event, date, timeZone))
    .sort(compareCalendarEvents);
}

export function calendarEventIntersectsDate(
  event: CalendarEvent,
  date: LocalDate,
  timeZone?: string,
): boolean {
  if (event.allDay) {
    return allDayEventIntersectsDate(event, date, timeZone);
  }

  const bounds = localDayBounds(date, timeZone);
  const startsAt = toDate(event.startsAt)?.getTime();
  const endsAt = event.endsAt ? toDate(event.endsAt)?.getTime() : undefined;
  if (!bounds || startsAt === undefined) {
    return false;
  }

  if (endsAt === undefined || endsAt <= startsAt) {
    return startsAt >= bounds.start && startsAt < bounds.end;
  }

  return startsAt < bounds.end && endsAt > bounds.start;
}

/** Deduplicates a locally mirrored Google event by external ID before rendering. */
export function dedupeCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = event.externalId ? `external:${event.externalId}` : `${event.source}:${event.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function nextCalendarEvent(
  events: CalendarEvent[],
  after: string | number | Date,
): CalendarEvent | undefined {
  const afterEpoch = toDate(after)?.getTime();
  if (afterEpoch === undefined) {
    return undefined;
  }

  return [...events]
    .filter(
      (event) => !event.allDay && (toDate(event.startsAt)?.getTime() ?? -Infinity) >= afterEpoch,
    )
    .sort(compareCalendarEvents)[0];
}

/**
 * Returns the Sunday-through-Saturday week containing `date`. A calendar card
 * can use these local date keys without relying on a static design reference
 * date or on the browser's implicit UTC conversion.
 */
export function calendarWeekForDate(date: LocalDate): LocalDate[] {
  const dayOfWeek = dayOfWeekForDate(date);
  if (dayOfWeek === undefined) {
    return [];
  }

  const weekStart = addCalendarDays(date, -dayOfWeek);
  if (!weekStart) {
    return [];
  }

  const days: LocalDate[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addCalendarDays(weekStart, offset);
    if (!day) {
      return [];
    }
    days.push(day);
  }
  return days;
}

function allDayEventIntersectsDate(
  event: CalendarEvent,
  date: LocalDate,
  timeZone?: string,
): boolean {
  const startsOn = dateValue(event.startsAt, timeZone);
  const endsOn = event.endsAt ? dateValue(event.endsAt, timeZone) : undefined;
  if (!startsOn) {
    return false;
  }

  if (!endsOn || endsOn <= startsOn) {
    return startsOn === date;
  }
  return startsOn <= date && date < endsOn;
}

function dateValue(value: string, timeZone?: string): LocalDate | undefined {
  return isLocalDate(value) ? value : localDateKey(value, timeZone);
}

function compareCalendarEvents(left: CalendarEvent, right: CalendarEvent): number {
  if (left.allDay !== right.allDay) {
    return left.allDay ? -1 : 1;
  }
  return (
    left.startsAt.localeCompare(right.startsAt) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}
