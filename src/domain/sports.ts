import { toDate } from "./date";
import type { SportsEvent, SportsPreferences } from "./types";

export type SportsEventGroup = "live" | "upcoming" | "final" | "other";

/** Converts provider-shaped unknown data into the one model the UI understands. */
export function normalizeSportsEvent(value: unknown): SportsEvent | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const id = stringValue(record.id);
  const sport = stringValue(record.sport);
  const league = stringValue(record.league);
  const startTime = stringValue(record.startTime);
  const homeName = stringValue(record.homeName);
  const awayName = stringValue(record.awayName);
  const status = validStatus(record.status);
  if (
    !id ||
    !sport ||
    !league ||
    !startTime ||
    !toDate(startTime) ||
    !homeName ||
    !awayName ||
    !status
  ) {
    return undefined;
  }

  return {
    id,
    sport,
    league,
    startTime,
    homeName,
    awayName,
    homeBadgeUrl: stringValue(record.homeBadgeUrl),
    awayBadgeUrl: stringValue(record.awayBadgeUrl),
    homeScore: finiteNumber(record.homeScore),
    awayScore: finiteNumber(record.awayScore),
    status,
    clockOrPeriod: stringValue(record.clockOrPeriod),
  };
}

export function sportsEventGroup(event: SportsEvent): SportsEventGroup {
  switch (event.status) {
    case "live":
      return "live";
    case "scheduled":
      return "upcoming";
    case "final":
      return "final";
    case "postponed":
    case "cancelled":
      return "other";
  }
}

export function isFavoriteSportsEvent(
  event: SportsEvent,
  preferences: SportsPreferences = {},
): boolean {
  const favoriteTeams = normalizedSet(preferences.favoriteTeams);
  const favoriteLeagues = normalizedSet(preferences.favoriteLeagues);
  return (
    favoriteTeams.has(normalizeName(event.homeName)) ||
    favoriteTeams.has(normalizeName(event.awayName)) ||
    favoriteLeagues.has(normalizeName(event.league))
  );
}

/**
 * One calm ribbon ordering: live, then upcoming, then final, then unavailable
 * states. Within each group, favorites lead and finals show the most recent
 * result first.
 */
export function sortSportsEvents(
  events: SportsEvent[],
  preferences: SportsPreferences = {},
): SportsEvent[] {
  return [...events].sort((left, right) => {
    const groupDifference = groupRank(sportsEventGroup(left)) - groupRank(sportsEventGroup(right));
    if (groupDifference !== 0) {
      return groupDifference;
    }

    const favoriteDifference =
      Number(isFavoriteSportsEvent(right, preferences)) -
      Number(isFavoriteSportsEvent(left, preferences));
    if (favoriteDifference !== 0) {
      return favoriteDifference;
    }

    const leftTime = eventEpoch(left);
    const rightTime = eventEpoch(right);
    const timeDifference =
      sportsEventGroup(left) === "final" ? rightTime - leftTime : leftTime - rightTime;
    if (timeDifference !== 0) {
      return timeDifference;
    }

    return (
      left.league.localeCompare(right.league) ||
      left.homeName.localeCompare(right.homeName) ||
      left.awayName.localeCompare(right.awayName) ||
      left.id.localeCompare(right.id)
    );
  });
}

function groupRank(group: SportsEventGroup): number {
  switch (group) {
    case "live":
      return 0;
    case "upcoming":
      return 1;
    case "final":
      return 2;
    case "other":
      return 3;
  }
}

function eventEpoch(event: SportsEvent): number {
  return toDate(event.startTime)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validStatus(value: unknown): SportsEvent["status"] | undefined {
  return value === "scheduled" ||
    value === "live" ||
    value === "final" ||
    value === "postponed" ||
    value === "cancelled"
    ? value
    : undefined;
}

function normalizedSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalizeName));
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}
