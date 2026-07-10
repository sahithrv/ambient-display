import { describe, expect, it } from "vitest";

import { localDayBounds, zonedDateTimeToIso } from "./date";

describe("time-zone-safe date helpers", () => {
  it("handles the spring DST boundary without inventing a nonexistent local time", () => {
    const timeZone = "America/Los_Angeles";

    expect(zonedDateTimeToIso("2026-03-08", "01:30", timeZone)).toBe("2026-03-08T09:30:00.000Z");
    expect(zonedDateTimeToIso("2026-03-08", "02:30", timeZone)).toBeUndefined();
    expect(zonedDateTimeToIso("2026-03-08", "03:30", timeZone)).toBe("2026-03-08T10:30:00.000Z");
  });

  it("uses a 23-hour local day when daylight saving begins", () => {
    const bounds = localDayBounds("2026-03-08", "America/Los_Angeles");

    expect(bounds).toBeDefined();
    expect((bounds?.end ?? 0) - (bounds?.start ?? 0)).toBe(23 * 60 * 60 * 1_000);
  });
});
