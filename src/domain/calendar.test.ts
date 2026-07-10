import { describe, expect, it } from "vitest";

import { calendarEventsForDate, calendarWeekForDate, dedupeCalendarEvents } from "./calendar";
import type { CalendarEvent } from "./types";

describe("calendar day filtering", () => {
  it("includes timed events that cross a local midnight on both dates", () => {
    const event: CalendarEvent = {
      id: "late-call",
      title: "Late call",
      startsAt: "2026-07-10T06:30:00.000Z",
      endsAt: "2026-07-10T08:30:00.000Z",
      allDay: false,
      source: "local",
    };
    const timeZone = "America/Los_Angeles";

    expect(calendarEventsForDate([event], "2026-07-09", timeZone)).toEqual([event]);
    expect(calendarEventsForDate([event], "2026-07-10", timeZone)).toEqual([event]);
    expect(calendarEventsForDate([event], "2026-07-11", timeZone)).toEqual([]);
  });

  it("uses exclusive end dates for all-day calendar events", () => {
    const event: CalendarEvent = {
      id: "trip",
      title: "Trip",
      startsAt: "2026-07-09",
      endsAt: "2026-07-11",
      allDay: true,
      source: "google",
    };

    expect(calendarEventsForDate([event], "2026-07-09")).toEqual([event]);
    expect(calendarEventsForDate([event], "2026-07-10")).toEqual([event]);
    expect(calendarEventsForDate([event], "2026-07-11")).toEqual([]);
  });

  it("deduplicates a local mirror and its Google source by external ID", () => {
    const events: CalendarEvent[] = [
      {
        id: "local-1",
        title: "Dentist",
        startsAt: "2026-07-09T17:00:00.000Z",
        allDay: false,
        source: "local",
        externalId: "google-42",
      },
      {
        id: "google-42",
        title: "Dentist",
        startsAt: "2026-07-09T17:00:00.000Z",
        allDay: false,
        source: "google",
        externalId: "google-42",
      },
    ];

    expect(dedupeCalendarEvents(events)).toEqual([events[0]]);
  });

  it("derives the actual Sunday-through-Saturday week for the selected local date", () => {
    expect(calendarWeekForDate("2026-07-09")).toEqual([
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
    ]);
  });

  it("returns no invented week for an invalid local date", () => {
    expect(calendarWeekForDate("2026-02-30")).toEqual([]);
  });
});
