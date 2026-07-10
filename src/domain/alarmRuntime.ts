import { nextAlarmOccurrence } from "./localData";
import type { Alarm } from "./types";

/** A concrete, scheduled occurrence rather than an arbitrary alarm record. */
export interface ScheduledAlarmOccurrence {
  alarm: Alarm;
  /** Epoch milliseconds, kept numeric for reliable scheduler comparisons. */
  occursAt: number;
  /** Stable across interval ticks and safe to retain in a fired-occurrence set. */
  occurrenceKey: string;
}

/**
 * Chooses the chronologically first next occurrence across every enabled alarm.
 * Ties are broken by alarm id so the selection remains deterministic.
 */
export function nextScheduledAlarmOccurrence(
  alarms: readonly Alarm[],
  after: number,
  timeZone?: string,
): ScheduledAlarmOccurrence | undefined {
  if (!Number.isFinite(after)) {
    return undefined;
  }

  return toScheduledOccurrences(alarms, after, timeZone)[0];
}

/**
 * Finds the first occurrence for each alarm inside a bounded active-app window.
 * A bounded window lets a delayed browser timer recover from a short sleep or
 * background pause without surprising someone with alarms from much earlier.
 */
export function dueScheduledAlarmOccurrences(
  alarms: readonly Alarm[],
  fromInclusive: number,
  throughInclusive: number,
  alreadyFired: ReadonlySet<string> = new Set(),
  timeZone?: string,
): ScheduledAlarmOccurrence[] {
  if (!Number.isFinite(fromInclusive) || !Number.isFinite(throughInclusive)) {
    return [];
  }

  const start = Math.min(fromInclusive, throughInclusive);
  const end = Math.max(fromInclusive, throughInclusive);

  return toScheduledOccurrences(alarms, start - 1, timeZone).filter(
    (occurrence) =>
      occurrence.occursAt >= start &&
      occurrence.occursAt <= end &&
      !alreadyFired.has(occurrence.occurrenceKey),
  );
}

export function alarmOccurrenceKey(alarmId: string, occursAt: number): string {
  return `${alarmId}:${new Date(occursAt).toISOString()}`;
}

function toScheduledOccurrences(
  alarms: readonly Alarm[],
  after: number,
  timeZone?: string,
): ScheduledAlarmOccurrence[] {
  return alarms
    .flatMap((alarm) => {
      const occurrence = nextAlarmOccurrence(alarm, after, timeZone);
      if (!occurrence) {
        return [];
      }
      const occursAt = Date.parse(occurrence);
      if (!Number.isFinite(occursAt)) {
        return [];
      }
      return [{ alarm, occursAt, occurrenceKey: alarmOccurrenceKey(alarm.id, occursAt) }];
    })
    .sort(
      (left, right) =>
        left.occursAt - right.occursAt || left.alarm.id.localeCompare(right.alarm.id),
    );
}
