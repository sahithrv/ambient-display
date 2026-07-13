import { describe, expect, it } from "vitest";

import {
  favoriteSportsTeamIds,
  normalizeSportsEvent,
  selectSportsEvents,
  sortSportsEvents,
  sportsEventGroup,
  sportsTeamsFromEvents,
} from "./sports";
import type { SportsEvent, SportsPreferences } from "./types";

const preferences = (
  favoriteTeams: SportsPreferences["favoriteTeams"],
  showOnlyFavorites = false,
): SportsPreferences => ({
  version: 1,
  favoriteTeams,
  favoriteLeagues: [],
  showOnlyFavorites,
});

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
          homeTeamId: "133600",
          homeName: "Golden State Warriors",
          startTime: "2026-07-09T20:00:00.000Z",
        }),
      ],
      preferences([{ id: "133600", name: "Golden State Warriors" }]),
    );

    expect(ordered.map((item) => item.id)).toEqual(["favorite", "earlier"]);
  });

  it("filters unrelated games by stable team ID and keeps favorite display order", () => {
    const chosen = preferences(
      [
        { id: "200", name: "Second choice" },
        { id: "100", name: "First choice" },
      ],
      true,
    );
    const selected = selectSportsEvents(
      [
        event({ id: "unrelated", homeTeamId: "300", homeName: "Other" }),
        event({ id: "second", awayTeamId: "100", awayName: "First choice" }),
        event({ id: "first", homeTeamId: "200", homeName: "Second choice" }),
      ],
      chosen,
    );

    expect(selected.map((item) => item.id)).toEqual(["first", "second"]);
    expect(favoriteSportsTeamIds(chosen)).toEqual(["200", "100"]);
  });

  it("derives picker choices from normalized events while preserving provider IDs", () => {
    expect(
      sportsTeamsFromEvents([
        event({
          league: "NBA",
          homeTeamId: "133600",
          homeName: "Warriors",
          awayTeamId: "134860",
          awayName: "Lakers",
        }),
      ]),
    ).toEqual([
      { id: "134860", name: "Lakers", league: "NBA", sport: "Basketball" },
      { id: "133600", name: "Warriors", league: "NBA", sport: "Basketball" },
    ]);
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

  it("drops malformed provider IDs without discarding an otherwise valid event", () => {
    expect(
      normalizeSportsEvent({
        ...event({}),
        leagueId: "league/unsafe",
        homeTeamId: "133600",
        awayTeamId: "not numeric",
      }),
    ).toMatchObject({ homeTeamId: "133600", leagueId: undefined, awayTeamId: undefined });
  });

  it("keeps only HTTPS badge URLs in normalized cached events", () => {
    expect(
      normalizeSportsEvent({
        ...event({}),
        homeBadgeUrl: "https://images.example.test/home.png",
        awayBadgeUrl: "http://images.example.test/away.png",
      }),
    ).toMatchObject({
      homeBadgeUrl: "https://images.example.test/home.png",
      awayBadgeUrl: undefined,
    });
  });
});
