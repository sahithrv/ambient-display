import {
  addCalendarDays,
  dayOfWeekForDate,
  formatLocalTime,
  isLocalDate,
  localDateKey,
  parseLocalTime,
  toDate,
  zonedDateTimeToIso,
  type InstantLike,
} from "./date";
import type {
  AmbientCommand,
  CommandParseFailureReason,
  CommandParseResult,
  DayPart,
  LocalDate,
  SceneKey,
  WeatherFamily,
} from "./types";
import { sceneKeyFor } from "./weather";

export interface CommandParserContext {
  /** Pass a fixed value in previews/tests so natural dates remain deterministic. */
  now?: InstantLike;
  timeZone?: string;
  dayPart?: DayPart;
  defaultReminderTime?: string;
  defaultSnoozeMinutes?: number;
}

interface DateExtraction {
  date?: LocalDate;
  source: "implicit" | "today" | "tomorrow" | "weekday" | "iso";
  remainder: string;
  error?: string;
}

interface TimeExtraction {
  time?: string;
  remainder: string;
  hadAtClause: boolean;
  error?: string;
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Deterministic intent parsing for the small, supported command grammar. It
 * deliberately returns a failure instead of guessing when a reminder's date,
 * time, or title cannot be established safely.
 */
export function parseTypedCommand(
  input: string,
  context: CommandParserContext = {},
): CommandParseResult {
  const prepared = input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "");
  const normalizedInput = prepared.toLocaleLowerCase();
  if (!normalizedInput) {
    return failure("empty", "Type a command to continue.", normalizedInput);
  }

  const simpleCommand = parseSimpleCommand(normalizedInput, context);
  if (simpleCommand) {
    return success(simpleCommand, normalizedInput);
  }

  const taskCommand = parseTaskCommand(prepared);
  if (taskCommand) {
    return success(taskCommand, normalizedInput);
  }

  if (isReminderPrefix(normalizedInput)) {
    return parseReminderCommand(prepared, normalizedInput, context);
  }

  return failure(
    "unsupported",
    "Try a reminder, task, calendar, sports, snooze, or scene command.",
    normalizedInput,
  );
}

function parseSimpleCommand(
  normalizedInput: string,
  context: CommandParserContext,
): AmbientCommand | undefined {
  if (
    /^(?:what(?:'s| is) on (?:my )?calendar(?: today)?|show (?:my )?calendar(?: today)?|calendar)$/i.test(
      normalizedInput,
    )
  ) {
    return { type: "show-calendar" };
  }
  if (
    /^(?:show|open) (?:my )?sports?$|^(?:what(?:'s| is) )?(?:on )?sports?$/i.test(normalizedInput)
  ) {
    return { type: "show-sports" };
  }
  if (
    /^(?:show|open) (?:my )?(?:tasks?|to-?dos?)$|^(?:what(?:'s| are) )?(?:my )?(?:tasks?|to-?dos?)$/i.test(
      normalizedInput,
    )
  ) {
    return { type: "show-tasks" };
  }
  if (
    /^(?:return to )?(?:automatic|auto)(?: scene| mode)?$|^use automatic scene$/i.test(
      normalizedInput,
    )
  ) {
    return { type: "use-automatic-scene" };
  }

  const snoozeMatch = /^snooze(?:\s+(?:for\s+)?(.+))?$/i.exec(normalizedInput);
  if (snoozeMatch) {
    const minutes = snoozeMatch[1]
      ? parseSnoozeMinutes(snoozeMatch[1])
      : (context.defaultSnoozeMinutes ?? 10);
    return minutes === undefined ? undefined : { type: "snooze", minutes };
  }

  const sceneMatch = /^(switch to|lock|test(?: scene)?)\s+(.+?)(?:\s+(?:scene|mode))?$/i.exec(
    normalizedInput,
  );
  if (sceneMatch) {
    const sceneKey = parseScene(sceneMatch[2], context.dayPart);
    if (!sceneKey) {
      return undefined;
    }
    return sceneMatch[1].startsWith("test")
      ? { type: "test-scene", sceneKey }
      : { type: "lock-scene", sceneKey };
  }

  return undefined;
}

function parseTaskCommand(input: string): AmbientCommand | undefined {
  const addMatch = /^(?:add|create)\s+(?:a\s+)?(.+?)\s+(?:to\s+)?(?:my\s+)?tasks?$/i.exec(input);
  if (addMatch) {
    const title = normalizeTitle(addMatch[1]);
    return title ? { type: "add-task", title } : undefined;
  }

  const completeMatch =
    /^(?:mark|complete|finish)\s+(?:the\s+)?(?:task\s+)?(.+?)(?:\s+(?:as\s+)?(?:complete|completed|done))$/i.exec(
      input,
    );
  if (completeMatch) {
    const title = normalizeTitle(completeMatch[1]);
    return title ? { type: "complete-task", title } : undefined;
  }

  return undefined;
}

function parseReminderCommand(
  input: string,
  normalizedInput: string,
  context: CommandParserContext,
): CommandParseResult {
  const prefix = /^(?:remind me|create\s+(?:a\s+)?reminder|add\s+(?:a\s+)?reminder)\s+(.+)$/i.exec(
    input,
  );
  if (!prefix) {
    return failure("ambiguous", "Tell me what you want to be reminded about.", normalizedInput);
  }

  const now = toDate(context.now ?? new Date());
  const today = now && localDateKey(now, context.timeZone);
  if (!now || !today) {
    return failure(
      "invalid-date",
      "The current local date could not be resolved.",
      normalizedInput,
    );
  }

  const dateExtraction = extractDate(prefix[1], today);
  if (dateExtraction.error) {
    return failure("invalid-date", dateExtraction.error, normalizedInput);
  }

  const timeExtraction = extractTime(dateExtraction.remainder);
  if (timeExtraction.error) {
    return failure("invalid-time", timeExtraction.error, normalizedInput);
  }

  if (!dateExtraction.date && !timeExtraction.time) {
    return failure(
      "ambiguous",
      "Include a day or time, for example “tomorrow at 9 AM”.",
      normalizedInput,
    );
  }

  let date = dateExtraction.date ?? today;
  const time = timeExtraction.time ?? context.defaultReminderTime ?? "09:00";
  if (!parseLocalTime(time)) {
    return failure("invalid-time", "The default reminder time is invalid.", normalizedInput);
  }

  let startsAt = zonedDateTimeToIso(date, time, context.timeZone);
  if (!startsAt) {
    return failure("invalid-date", "That local reminder time does not exist.", normalizedInput);
  }

  if (new Date(startsAt).getTime() <= now.getTime()) {
    if (dateExtraction.source === "implicit") {
      date = addCalendarDays(date, 1) ?? date;
      startsAt = zonedDateTimeToIso(date, time, context.timeZone);
    } else if (dateExtraction.source === "weekday") {
      date = addCalendarDays(date, 7) ?? date;
      startsAt = zonedDateTimeToIso(date, time, context.timeZone);
    } else {
      return failure("ambiguous", "That reminder time has already passed.", normalizedInput);
    }
  }
  if (!startsAt) {
    return failure("invalid-date", "That local reminder time does not exist.", normalizedInput);
  }

  const title = normalizeTitle(timeExtraction.remainder);
  if (!title) {
    return failure("ambiguous", "Tell me what you want to be reminded about.", normalizedInput);
  }

  return success({ type: "create-reminder", title, startsAt, allDay: false }, normalizedInput);
}

function isReminderPrefix(normalizedInput: string): boolean {
  return /^(?:remind me|create\s+(?:a\s+)?reminder|add\s+(?:a\s+)?reminder)\b/i.test(
    normalizedInput,
  );
}

function extractDate(input: string, today: LocalDate): DateExtraction {
  const isoMatch = /\b\d{4}-\d{2}-\d{2}\b/.exec(input);
  if (isoMatch) {
    return isLocalDate(isoMatch[0])
      ? { date: isoMatch[0], source: "iso", remainder: removeMatch(input, isoMatch[0]) }
      : { source: "iso", remainder: input, error: "That ISO date is invalid." };
  }

  const relativeMatch = /\b(today|tomorrow)\b/i.exec(input);
  if (relativeMatch) {
    const source = relativeMatch[1].toLocaleLowerCase() as "today" | "tomorrow";
    const date = source === "today" ? today : addCalendarDays(today, 1);
    return date
      ? { date, source, remainder: removeMatch(input, relativeMatch[0]) }
      : { source, remainder: input, error: "That local date could not be resolved." };
  }

  const weekdayMatch =
    /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(input);
  if (weekdayMatch) {
    const currentDay = dayOfWeekForDate(today);
    const targetDay = WEEKDAYS.indexOf(
      weekdayMatch[2].toLocaleLowerCase() as (typeof WEEKDAYS)[number],
    );
    if (currentDay === undefined || targetDay === -1) {
      return { source: "weekday", remainder: input, error: "That weekday could not be resolved." };
    }
    let difference = (targetDay - currentDay + 7) % 7;
    if (weekdayMatch[1] && difference === 0) {
      difference = 7;
    }
    const date = addCalendarDays(today, difference);
    return date
      ? { date, source: "weekday", remainder: removeMatch(input, weekdayMatch[0]) }
      : { source: "weekday", remainder: input, error: "That weekday could not be resolved." };
  }

  return { source: "implicit", remainder: input };
}

function extractTime(input: string): TimeExtraction {
  const atClause = /\bat\s+([^\s]+(?:\s*(?:a\.?m\.?|p\.?m\.?))?)/i.exec(input);
  if (!atClause) {
    return { remainder: input, hadAtClause: false };
  }

  const time = parseSpokenTime(atClause[1]);
  return time
    ? { time, remainder: removeMatch(input, atClause[0]), hadAtClause: true }
    : {
        remainder: input,
        hadAtClause: true,
        error: "Use a time such as 9 AM, 9:30 PM, or 14:30.",
      };
}

function parseSpokenTime(value: string): string | undefined {
  const normalized = value.trim().toLocaleLowerCase().replace(/\./g, "");
  if (normalized === "noon") {
    return "12:00";
  }
  if (normalized === "midnight") {
    return "00:00";
  }

  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(normalized);
  if (!match) {
    return undefined;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const meridiem = match[3];
  if (minutes > 59) {
    return undefined;
  }
  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return undefined;
    }
    if (meridiem === "am") {
      hours = hours === 12 ? 0 : hours;
    } else {
      hours = hours === 12 ? 12 : hours + 12;
    }
  } else if (hours > 23) {
    return undefined;
  }

  return formatLocalTime({ hours, minutes });
}

function parseSnoozeMinutes(value: string): number | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  const match =
    /^(\d+|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|forty-five|forty five|sixty)\s*(minutes?|mins?|hours?|hrs?)?$/i.exec(
      normalized,
    );
  if (!match) {
    return undefined;
  }

  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    ten: 10,
    fifteen: 15,
    twenty: 20,
    thirty: 30,
    forty: 40,
    "forty-five": 45,
    "forty five": 45,
    sixty: 60,
  };
  const amount = /^\d+$/.test(match[1]) ? Number(match[1]) : words[match[1]];
  const minutes = match[2]?.startsWith("h") ? amount * 60 : amount;
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 24 * 60 ? minutes : undefined;
}

function parseScene(value: string, fallbackDayPart: DayPart | undefined): SceneKey | undefined {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/\b(?:the|a|an)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const explicitKey = normalized.replace(/\s+/g, ".");
  if (isSceneKey(explicitKey)) {
    return explicitKey;
  }

  const weatherFamily = sceneWeatherFamily(normalized);
  if (!weatherFamily) {
    return undefined;
  }

  const dayPart = /\b(dawn|sunrise|morning)\b/.test(normalized)
    ? "dawn"
    : /\b(sunset|evening|dusk)\b/.test(normalized)
      ? "sunset"
      : /\b(night|nighttime)\b/.test(normalized)
        ? "night"
        : /\b(day|daytime)\b/.test(normalized)
          ? "day"
          : (fallbackDayPart ?? "day");
  return sceneKeyFor(weatherFamily, dayPart);
}

function sceneWeatherFamily(value: string): WeatherFamily | undefined {
  if (/\b(clear|sunny)\b/.test(value)) {
    return "clear";
  }
  if (/\b(cloudy|cloud)\b/.test(value)) {
    return "cloudy";
  }
  if (/\b(rain|rainy|drizzle|shower)\b/.test(value)) {
    return "rain";
  }
  if (/\b(storm|stormy|thunder)\b/.test(value)) {
    return "storm";
  }
  if (/\b(fog|foggy)\b/.test(value)) {
    return "fog";
  }
  if (/\b(snow|snowy)\b/.test(value)) {
    return "snow";
  }
  if (/\b(fallback)\b/.test(value)) {
    return "fallback";
  }
  return undefined;
}

function isSceneKey(value: string): value is SceneKey {
  return [
    "clear.dawn",
    "clear.day",
    "clear.sunset",
    "clear.night",
    "cloudy.day",
    "cloudy.night",
    "rain.day",
    "rain.night",
    "storm.any",
    "fog.any",
    "snow.any",
    "fallback.any",
  ].includes(value as SceneKey);
}

function normalizeTitle(value: string): string | undefined {
  const title = value
    .replace(/^\s*(?:to|for)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return title.length > 0 ? title : undefined;
}

function removeMatch(input: string, match: string): string {
  return input.replace(match, " ").replace(/\s+/g, " ").trim();
}

function success(command: AmbientCommand, normalizedInput: string): CommandParseResult {
  return { ok: true, command, normalizedInput };
}

function failure(
  reason: CommandParseFailureReason,
  message: string,
  normalizedInput: string,
): CommandParseResult {
  return { ok: false, reason, message, normalizedInput };
}
