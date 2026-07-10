import { describe, expect, it } from "vitest";

import { parseTypedCommand } from "./commands";

describe("typed command parser", () => {
  const context = {
    now: "2026-07-09T15:00:00.000Z",
    timeZone: "America/Los_Angeles",
    dayPart: "night" as const,
  };

  it("creates a precise local reminder from the documented grammar", () => {
    const result = parseTypedCommand("Remind me tomorrow at 9 AM to call the dentist.", context);

    expect(result).toMatchObject({
      ok: true,
      command: {
        type: "create-reminder",
        title: "call the dentist",
        startsAt: "2026-07-10T16:00:00.000Z",
      },
    });
  });

  it("parses task, display, snooze, and scene commands without an LLM", () => {
    expect(parseTypedCommand("Add buy groceries to my tasks.", context)).toMatchObject({
      ok: true,
      command: { type: "add-task", title: "buy groceries" },
    });
    expect(parseTypedCommand("Mark buy groceries complete.", context)).toMatchObject({
      ok: true,
      command: { type: "complete-task", title: "buy groceries" },
    });
    expect(parseTypedCommand("What is on my calendar today?", context)).toMatchObject({
      ok: true,
      command: { type: "show-calendar" },
    });
    expect(parseTypedCommand("Show sports.", context)).toMatchObject({
      ok: true,
      command: { type: "show-sports" },
    });
    expect(parseTypedCommand("Snooze for ten minutes.", context)).toMatchObject({
      ok: true,
      command: { type: "snooze", minutes: 10 },
    });
    expect(parseTypedCommand("Switch to rain mode.", context)).toMatchObject({
      ok: true,
      command: { type: "lock-scene", sceneKey: "rain.night" },
    });
    expect(parseTypedCommand("Return to automatic mode.", context)).toMatchObject({
      ok: true,
      command: { type: "use-automatic-scene" },
    });
  });

  it("does not silently create an underspecified reminder", () => {
    expect(parseTypedCommand("Remind me to call the dentist.", context)).toMatchObject({
      ok: false,
      reason: "ambiguous",
    });
    expect(
      parseTypedCommand("Remind me tomorrow at 27:00 to call the dentist.", context),
    ).toMatchObject({
      ok: false,
      reason: "invalid-time",
    });
  });
});
