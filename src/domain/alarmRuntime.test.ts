import { describe, expect, it } from "vitest";

import {
  alarmOccurrenceKey,
  dueScheduledAlarmOccurrences,
  nextScheduledAlarmOccurrence,
} from "./alarmRuntime";
import type { Alarm } from "./types";

const morning: Alarm = {
  id: "morning",
  label: "Morning briefing",
  localTime: "09:00",
  daysOfWeek: [],
  enabled: true,
  soundId: "default",
  snoozeMinutes: 10,
};

const followUp: Alarm = {
  ...morning,
  id: "follow-up",
  label: "Stand-up",
  localTime: "09:01",
};

describe("alarm runtime selection", () => {
  it("selects the actual earliest occurrence rather than the first stored alarm", () => {
    const next = nextScheduledAlarmOccurrence(
      [followUp, morning],
      Date.parse("2026-07-09T15:30:00.000Z"),
      "America/Los_Angeles",
    );

    expect(next).toMatchObject({
      alarm: { id: "morning" },
      occursAt: Date.parse("2026-07-09T16:00:00.000Z"),
    });
  });

  it("returns every unfired occurrence inside a short recovery window in chronological order", () => {
    const due = dueScheduledAlarmOccurrences(
      [followUp, morning],
      Date.parse("2026-07-09T15:58:00.000Z"),
      Date.parse("2026-07-09T16:02:00.000Z"),
      new Set(),
      "America/Los_Angeles",
    );

    expect(due.map((occurrence) => occurrence.alarm.id)).toEqual(["morning", "follow-up"]);

    const onlyUnfired = dueScheduledAlarmOccurrences(
      [followUp, morning],
      Date.parse("2026-07-09T15:58:00.000Z"),
      Date.parse("2026-07-09T16:02:00.000Z"),
      new Set([alarmOccurrenceKey("morning", Date.parse("2026-07-09T16:00:00.000Z"))]),
      "America/Los_Angeles",
    );
    expect(onlyUnfired.map((occurrence) => occurrence.alarm.id)).toEqual(["follow-up"]);
  });
});
