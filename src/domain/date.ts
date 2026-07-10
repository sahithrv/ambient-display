import type { IsoDateTime, LocalDate } from "./types";

export type InstantLike = Date | number | string;

export interface LocalTime {
  hours: number;
  minutes: number;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export function toDate(value: InstantLike): Date | undefined {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function isLocalDate(value: string): boolean {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const [year, month, day] = match.slice(1).map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function parseLocalTime(value: string): LocalTime | undefined {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return undefined;
  }

  return { hours, minutes };
}

export function formatLocalTime(time: LocalTime): string {
  return `${String(time.hours).padStart(2, "0")}:${String(time.minutes).padStart(2, "0")}`;
}

export function localDateKey(value: InstantLike, timeZone?: string): LocalDate | undefined {
  const date = toDate(value);
  if (!date) {
    return undefined;
  }

  const parts = zonedParts(date.getTime(), timeZone);
  return parts ? dateKeyFromParts(parts) : undefined;
}

/** Sunday is 0 and Saturday is 6, independent of the runtime time zone. */
export function dayOfWeekForDate(date: LocalDate): number | undefined {
  const parsed = parseDateKey(date);
  if (!parsed) {
    return undefined;
  }

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

export function addCalendarDays(date: LocalDate, amount: number): LocalDate | undefined {
  const parsed = parseDateKey(date);
  if (!parsed || !Number.isInteger(amount)) {
    return undefined;
  }

  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(
    next.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Converts a local calendar date and local clock time into an instant. The
 * function returns undefined for a nonexistent wall-clock time (for example,
 * 02:30 during a spring-forward DST gap) so callers never create a surprising
 * reminder or alarm.
 */
export function zonedDateTimeToEpoch(
  date: LocalDate,
  time: string,
  timeZone?: string,
): number | undefined {
  const calendarDate = parseDateKey(date);
  const localTime = parseLocalTime(time);
  if (!calendarDate || !localTime) {
    return undefined;
  }

  const wallClockAsUtc = Date.UTC(
    calendarDate.year,
    calendarDate.month - 1,
    calendarDate.day,
    localTime.hours,
    localTime.minutes,
    0,
  );

  const firstOffset = timeZoneOffsetAt(wallClockAsUtc, timeZone);
  if (firstOffset === undefined) {
    return undefined;
  }

  let candidate = wallClockAsUtc - firstOffset;
  const secondOffset = timeZoneOffsetAt(candidate, timeZone);
  if (secondOffset === undefined) {
    return undefined;
  }
  candidate = wallClockAsUtc - secondOffset;

  const resolved = zonedParts(candidate, timeZone);
  if (
    !resolved ||
    resolved.year !== calendarDate.year ||
    resolved.month !== calendarDate.month ||
    resolved.day !== calendarDate.day ||
    resolved.hours !== localTime.hours ||
    resolved.minutes !== localTime.minutes
  ) {
    return undefined;
  }

  return candidate;
}

export function zonedDateTimeToIso(
  date: LocalDate,
  time: string,
  timeZone?: string,
): IsoDateTime | undefined {
  const epoch = zonedDateTimeToEpoch(date, time, timeZone);
  return epoch === undefined ? undefined : new Date(epoch).toISOString();
}

export function localDayBounds(
  date: LocalDate,
  timeZone?: string,
): { start: number; end: number } | undefined {
  const nextDate = addCalendarDays(date, 1);
  if (!nextDate) {
    return undefined;
  }

  const start = zonedDateTimeToEpoch(date, "00:00", timeZone);
  const end = zonedDateTimeToEpoch(nextDate, "00:00", timeZone);
  return start === undefined || end === undefined ? undefined : { start, end };
}

export function zonedParts(epoch: number, timeZone?: string): DateParts | undefined {
  if (!Number.isFinite(epoch)) {
    return undefined;
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(epoch))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );

    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    const hours = Number(values.hour);
    const minutes = Number(values.minute);
    const seconds = Number(values.second);
    if ([year, month, day, hours, minutes, seconds].some(Number.isNaN)) {
      return undefined;
    }

    return { year, month, day, hours, minutes, seconds };
  } catch {
    return undefined;
  }
}

function parseDateKey(date: LocalDate): Pick<DateParts, "year" | "month" | "day"> | undefined {
  if (!isLocalDate(date)) {
    return undefined;
  }

  const match = DATE_KEY_PATTERN.exec(date);
  if (!match) {
    return undefined;
  }

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function dateKeyFromParts(parts: Pick<DateParts, "year" | "month" | "day">): LocalDate {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function timeZoneOffsetAt(epoch: number, timeZone?: string): number | undefined {
  const parts = zonedParts(epoch, timeZone);
  if (!parts) {
    return undefined;
  }

  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hours,
    parts.minutes,
    parts.seconds,
  );
  return localAsUtc - epoch;
}
