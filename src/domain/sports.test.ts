import { describe, expect, it } from "vitest";

import { normalizeSportsEvent, sortSportsEvents, sportsEventGroup } from "./sports";
import type { SportsEvent } from "./types";

function event(overrides: Partial<SportsEvent>): SportsEvent {
  return {
    id: "base",
    sport: "Basketball",
    league: "NBA",
    startTime: "2026-07-09T18:00:00.000Z",
    homeName: "Home",
    awayName: "Away",
    status: "scheduled",
    ...overrides,
  };
}

describe("sports event normalization and ordering", () => {
  it("orders the ribbon as live, upcoming, final, then unavailable", () => {
    const ordered = sortSportsEvents([
      event({ id: "final-old", status: "final", startTime: "2026-07-08T18:00:00.000Z" }),
      event({ id: "postponed", status: "postponed" }),
      event({ id: "upcoming", status: "scheduled", startTime: "2026-07-09T20:00:00.000Z" }),
      event({ id: "live", status: "live" }),
      event({ id: "final-new", status: "final", startTime: "2026-07-09T18:00:00.000Z" }),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "live",
      "upcoming",
      "final-new",
      "final-old",
      "postponed",
    ]);
    expect(sportsEventGroup(ordered[0])).toBe("live");
  });

  it("prioritizes a favorite team within the same calm status group", () => {
    const ordered = sortSportsEvents(
      [
        event({ id: "earlier", startTime: "2026-07-09T18:00:00.000Z" }),
        event({
          id: "favorite",
          homeName: "Golden State Warriors",
          startTime: "2026-07-09T20:00:00.000Z",
        }),
      ],
      { favoriteTeams: ["Golden State Warriors"] },
    );

    expect(ordered.map((item) => item.id)).toEqual(["favorite", "earlier"]);
  });

  it("rejects malformed provider records rather than leaking a partial event into the UI", () => {
    expect(normalizeSportsEvent({ id: "missing-fields" })).toBeUndefined();
    expect(
      normalizeSportsEvent({
        ...event({}),
        status: "not-a-real-status",
      }),
    ).toBeUndefined();
  });
});
