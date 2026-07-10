import {
  addCalendarDays,
  dayOfWeekForDate,
  localDateKey,
  toDate,
  zonedDateTimeToEpoch,
  type InstantLike,
} from "./date";
import type {
  Alarm,
  CelebrationEvent,
  DailyTaskInstance,
  DailyTaskState,
  IsoDateTime,
  LocalData,
  LocalDate,
  Reminder,
  RepeatingTask,
  TaskProgress,
} from "./types";

export const LOCAL_DATA_VERSION = 1 as const;

export function createEmptyLocalData(): LocalData {
  return {
    version: LOCAL_DATA_VERSION,
    presenceEnabled: false,
    tasks: [],
    taskStates: [],
    reminders: [],
    alarms: [],
    celebrations: [],
  };
}

/** JSON serialization lives at the persistence boundary; no storage API is used here. */
export function serializeLocalData(data: LocalData): string {
  return JSON.stringify(normalizeLocalData(data));
}

/** Invalid/missing persisted data becomes an empty, valid local-first store. */
export function deserializeLocalData(value: string | null | undefined): LocalData {
  if (!value) {
    return createEmptyLocalData();
  }

  try {
    return normalizeLocalData(JSON.parse(value) as unknown);
  } catch {
    return createEmptyLocalData();
  }
}

/** Defensively strips unknown fields and malformed records before persistence or rendering. */
export function normalizeLocalData(value: unknown): LocalData {
  const record = asRecord(value);
  if (!record) {
    return createEmptyLocalData();
  }

  return {
    version: LOCAL_DATA_VERSION,
    presenceEnabled: record.presenceEnabled === true,
    tasks: uniqueBy(parseArray(record.tasks, parseTask), (task) => task.id),
    taskStates: uniqueBy(
      parseArray(record.taskStates, parseTaskState),
      (state) => `${state.date}:${state.taskId}`,
    ),
    reminders: uniqueBy(parseArray(record.reminders, parseReminder), (reminder) => reminder.id),
    alarms: uniqueBy(parseArray(record.alarms, parseAlarm), (alarm) => alarm.id),
    celebrations: uniqueBy(
      parseArray(record.celebrations, parseCelebration),
      (celebration) => `${celebration.date}:${celebration.reason}`,
    ),
  };
}

export function isTaskScheduledOnDate(task: RepeatingTask, date: LocalDate): boolean {
  if (!task.enabled) {
    return false;
  }

  if (task.daysOfWeek.length === 0) {
    return true;
  }

  const dayOfWeek = dayOfWeekForDate(date);
  return dayOfWeek !== undefined && task.daysOfWeek.includes(dayOfWeek);
}

export function dailyTaskInstances(
  tasks: RepeatingTask[],
  states: DailyTaskState[],
  date: LocalDate,
): DailyTaskInstance[] {
  const completedByTaskId = new Map(
    states
      .filter((state) => state.date === date)
      .map((state) => [state.taskId, state.completedAt] as const),
  );

  return tasks
    .filter((task) => isTaskScheduledOnDate(task, date))
    .sort(compareTasks)
    .map((task) => ({ date, task, completedAt: completedByTaskId.get(task.id) }));
}

export function taskProgressForDate(
  tasks: RepeatingTask[],
  states: DailyTaskState[],
  date: LocalDate,
): TaskProgress {
  return dailyTaskInstances(tasks, states, date).reduce<TaskProgress>(
    (progress, instance) => ({
      total: progress.total + 1,
      completed: progress.completed + (instance.completedAt ? 1 : 0),
      requiredTotal: progress.requiredTotal + (instance.task.requiredForCelebration ? 1 : 0),
      requiredCompleted:
        progress.requiredCompleted +
        (instance.task.requiredForCelebration && instance.completedAt ? 1 : 0),
    }),
    { total: 0, completed: 0, requiredTotal: 0, requiredCompleted: 0 },
  );
}

export function markTaskCompleted(
  states: DailyTaskState[],
  taskId: string,
  date: LocalDate,
  completedAt: IsoDateTime,
): DailyTaskState[] {
  const index = states.findIndex((state) => state.taskId === taskId && state.date === date);
  if (index === -1) {
    return [...states, { taskId, date, completedAt }];
  }

  if (states[index].completedAt === completedAt) {
    return states;
  }

  return states.map((state, stateIndex) =>
    stateIndex === index ? { ...state, completedAt } : state,
  );
}

export function markTaskIncomplete(
  states: DailyTaskState[],
  taskId: string,
  date: LocalDate,
): DailyTaskState[] {
  return states.map((state) =>
    state.taskId === taskId && state.date === date ? { ...state, completedAt: undefined } : state,
  );
}

export function areRequiredTasksComplete(
  tasks: RepeatingTask[],
  states: DailyTaskState[],
  date: LocalDate,
): boolean {
  const progress = taskProgressForDate(tasks, states, date);
  return progress.requiredTotal > 0 && progress.requiredTotal === progress.requiredCompleted;
}

export function createTaskCompletionCelebration(
  tasks: RepeatingTask[],
  states: DailyTaskState[],
  celebrations: CelebrationEvent[],
  date: LocalDate,
  playedAt: IsoDateTime,
  enabled = true,
): CelebrationEvent | undefined {
  if (
    !enabled ||
    !areRequiredTasksComplete(tasks, states, date) ||
    celebrations.some((celebration) => celebration.date === date)
  ) {
    return undefined;
  }

  return { date, reason: "all-required-tasks-complete", playedAt };
}

export function isReminderOnDate(reminder: Reminder, date: LocalDate, timeZone?: string): boolean {
  const startsOn = localDateKey(reminder.startsAt, timeZone);
  if (!startsOn || startsOn > date) {
    return false;
  }

  if (!reminder.recurrence) {
    return startsOn === date;
  }

  if (reminder.recurrence.frequency === "daily") {
    return true;
  }

  const days = reminder.recurrence.daysOfWeek ?? [];
  const dateDay = dayOfWeekForDate(date);
  if (dateDay === undefined) {
    return false;
  }
  if (days.length === 0) {
    return dateDay === dayOfWeekForDate(startsOn);
  }
  return days.includes(dateDay);
}

export function remindersForDate(
  reminders: Reminder[],
  date: LocalDate,
  timeZone?: string,
): Reminder[] {
  return reminders
    .filter((reminder) => isReminderOnDate(reminder, date, timeZone))
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id),
    );
}

export function isAlarmScheduledOnDate(alarm: Alarm, date: LocalDate, timeZone?: string): boolean {
  if (!alarm.enabled || zonedDateTimeToEpoch(date, alarm.localTime, timeZone) === undefined) {
    return false;
  }

  if (alarm.daysOfWeek.length === 0) {
    return true;
  }

  const dayOfWeek = dayOfWeekForDate(date);
  return dayOfWeek !== undefined && alarm.daysOfWeek.includes(dayOfWeek);
}

/** Finds the first eligible alarm strictly after `after`, respecting local day and DST. */
export function nextAlarmOccurrence(
  alarm: Alarm,
  after: InstantLike,
  timeZone?: string,
): IsoDateTime | undefined {
  if (!alarm.enabled || !parseAlarmTime(alarm.localTime)) {
    return undefined;
  }

  const afterDate = toDate(after);
  const firstDate = afterDate ? localDateKey(afterDate, timeZone) : undefined;
  if (!afterDate || !firstDate) {
    return undefined;
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidateDate = addCalendarDays(firstDate, offset);
    if (!candidateDate || !isAlarmScheduledOnDateInZone(alarm, candidateDate, timeZone)) {
      continue;
    }

    const epoch = zonedDateTimeToEpoch(candidateDate, alarm.localTime, timeZone);
    if (epoch !== undefined && epoch > afterDate.getTime()) {
      return new Date(epoch).toISOString();
    }
  }

  return undefined;
}

export function snoozeUntil(now: InstantLike, snoozeMinutes: number): IsoDateTime | undefined {
  const date = toDate(now);
  if (!date || !Number.isFinite(snoozeMinutes) || snoozeMinutes <= 0) {
    return undefined;
  }

  return new Date(date.getTime() + snoozeMinutes * 60_000).toISOString();
}

function isAlarmScheduledOnDateInZone(alarm: Alarm, date: LocalDate, timeZone?: string): boolean {
  if (!alarm.enabled || zonedDateTimeToEpoch(date, alarm.localTime, timeZone) === undefined) {
    return false;
  }
  if (alarm.daysOfWeek.length === 0) {
    return true;
  }

  const dayOfWeek = dayOfWeekForDate(date);
  return dayOfWeek !== undefined && alarm.daysOfWeek.includes(dayOfWeek);
}

function compareTasks(left: RepeatingTask, right: RepeatingTask): number {
  return (
    left.sortOrder - right.sortOrder ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function parseAlarmTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseArray<T>(value: unknown, parse: (candidate: unknown) => T | undefined): T[] {
  return Array.isArray(value)
    ? value.flatMap((candidate) => {
        const parsed = parse(candidate);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseTask(value: unknown): RepeatingTask | undefined {
  const record = asRecord(value);
  const id = record && stringValue(record.id);
  const title = record && stringValue(record.title);
  if (!record || !id || !title || typeof record.enabled !== "boolean") {
    return undefined;
  }

  return {
    id,
    title,
    enabled: record.enabled,
    daysOfWeek: weekdayArray(record.daysOfWeek),
    requiredForCelebration: record.requiredForCelebration === true,
    preferredTime: stringValue(record.preferredTime),
    sortOrder: finiteNumber(record.sortOrder) ?? 0,
  };
}

function parseTaskState(value: unknown): DailyTaskState | undefined {
  const record = asRecord(value);
  const date = record && stringValue(record.date);
  const taskId = record && stringValue(record.taskId);
  if (!record || !date || !taskId) {
    return undefined;
  }

  return { date, taskId, completedAt: stringValue(record.completedAt) };
}

function parseReminder(value: unknown): Reminder | undefined {
  const record = asRecord(value);
  const id = record && stringValue(record.id);
  const title = record && stringValue(record.title);
  const startsAt = record && stringValue(record.startsAt);
  if (!record || !id || !title || !startsAt || typeof record.allDay !== "boolean") {
    return undefined;
  }

  const recurrenceRecord = asRecord(record.recurrence);
  let recurrence: Reminder["recurrence"];
  if (
    recurrenceRecord &&
    (recurrenceRecord.frequency === "daily" || recurrenceRecord.frequency === "weekly")
  ) {
    recurrence = {
      frequency: recurrenceRecord.frequency,
      daysOfWeek: weekdayArray(recurrenceRecord.daysOfWeek),
    };
  }

  return {
    id,
    title,
    startsAt,
    endsAt: stringValue(record.endsAt),
    allDay: record.allDay,
    recurrence,
    notificationOffsetsMinutes: numberArray(record.notificationOffsetsMinutes),
    source: record.source === "google" ? "google" : "local",
    externalId: stringValue(record.externalId),
  };
}

function parseAlarm(value: unknown): Alarm | undefined {
  const record = asRecord(value);
  const id = record && stringValue(record.id);
  const localTime = record && stringValue(record.localTime);
  if (
    !record ||
    !id ||
    !localTime ||
    !parseAlarmTime(localTime) ||
    (record.enabled !== true && record.enabled !== false)
  ) {
    return undefined;
  }

  return {
    id,
    label: stringValue(record.label) ?? "Alarm",
    localTime,
    daysOfWeek: weekdayArray(record.daysOfWeek),
    enabled: record.enabled,
    soundId: stringValue(record.soundId) ?? "default",
    snoozeMinutes: Math.max(1, finiteNumber(record.snoozeMinutes) ?? 10),
  };
}

function parseCelebration(value: unknown): CelebrationEvent | undefined {
  const record = asRecord(value);
  const date = record && stringValue(record.date);
  const playedAt = record && stringValue(record.playedAt);
  if (!record || !date || !playedAt || record.reason !== "all-required-tasks-complete") {
    return undefined;
  }

  return { date, reason: "all-required-tasks-complete", playedAt };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function weekdayArray(value: unknown): number[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (day): day is number =>
              typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6,
          ),
        ),
      ].sort((left, right) => left - right)
    : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(
        (number): number is number => typeof number === "number" && Number.isFinite(number),
      )
    : [];
}
