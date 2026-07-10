import { describe, expect, it } from "vitest";

import {
  createTaskCompletionCelebration,
  dailyTaskInstances,
  deserializeLocalData,
  isReminderOnDate,
  markTaskCompleted,
  nextAlarmOccurrence,
  serializeLocalData,
  taskProgressForDate,
} from "./localData";
import type { Alarm, Reminder, RepeatingTask } from "./types";

const requiredDailyTask: RepeatingTask = {
  id: "water",
  title: "Water plants",
  enabled: true,
  daysOfWeek: [],
  requiredForCelebration: true,
  sortOrder: 1,
};

describe("local task, reminder, and alarm data", () => {
  it("keeps completion history by date so a new local day starts clean", () => {
    const completed = markTaskCompleted([], "water", "2026-03-08", "2026-03-08T16:00:00.000Z");

    expect(
      dailyTaskInstances([requiredDailyTask], completed, "2026-03-08")[0].completedAt,
    ).toBeDefined();
    expect(
      dailyTaskInstances([requiredDailyTask], completed, "2026-03-09")[0].completedAt,
    ).toBeUndefined();
    expect(taskProgressForDate([requiredDailyTask], completed, "2026-03-09")).toMatchObject({
      total: 1,
      completed: 0,
    });
  });

  it("emits the required-task celebration only once per date", () => {
    const states = markTaskCompleted([], "water", "2026-07-09", "2026-07-09T17:00:00.000Z");
    const first = createTaskCompletionCelebration(
      [requiredDailyTask],
      states,
      [],
      "2026-07-09",
      "2026-07-09T17:00:00.000Z",
    );
    const second = createTaskCompletionCelebration(
      [requiredDailyTask],
      states,
      first ? [first] : [],
      "2026-07-09",
      "2026-07-09T17:01:00.000Z",
    );

    expect(first).toMatchObject({ date: "2026-07-09", reason: "all-required-tasks-complete" });
    expect(second).toBeUndefined();
  });

  it("uses structured recurrence and validates data before it is persisted", () => {
    const reminder: Reminder = {
      id: "stretch",
      title: "Stretch",
      startsAt: "2026-07-06T16:00:00.000Z",
      allDay: false,
      recurrence: { frequency: "weekly", daysOfWeek: [1, 3, 5] },
      notificationOffsetsMinutes: [10],
      source: "local",
    };

    expect(isReminderOnDate(reminder, "2026-07-08", "America/Los_Angeles")).toBe(true);
    expect(isReminderOnDate(reminder, "2026-07-07", "America/Los_Angeles")).toBe(false);

    const parsed = deserializeLocalData(
      JSON.stringify({
        tasks: [{ ...requiredDailyTask, daysOfWeek: [0, 8, 0] }],
        alarms: [{ id: "bad", localTime: "29:00", enabled: true }],
      }),
    );
    expect(parsed.tasks[0].daysOfWeek).toEqual([0]);
    expect(parsed.alarms).toEqual([]);
    expect(deserializeLocalData(serializeLocalData(parsed))).toEqual(parsed);
  });

  it("round-trips only an explicit local camera-presence opt-in", () => {
    const enabled = deserializeLocalData(JSON.stringify({ presenceEnabled: true }));
    const malformed = deserializeLocalData(JSON.stringify({ presenceEnabled: "true" }));

    expect(enabled.presenceEnabled).toBe(true);
    expect(deserializeLocalData(serializeLocalData(enabled)).presenceEnabled).toBe(true);
    expect(malformed.presenceEnabled).toBe(false);
  });

  it("calculates the next scheduled local alarm across a date boundary", () => {
    const alarm: Alarm = {
      id: "morning",
      label: "Morning",
      localTime: "09:00",
      daysOfWeek: [],
      enabled: true,
      soundId: "default",
      snoozeMinutes: 10,
    };

    expect(nextAlarmOccurrence(alarm, "2026-07-09T16:30:00.000Z", "America/Los_Angeles")).toBe(
      "2026-07-10T16:00:00.000Z",
    );
  });
});
