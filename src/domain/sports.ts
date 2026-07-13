import { toDate } from "./date";
import type { SportsEvent, SportsPreferences, SportsTeamPreference } from "./types";

export type SportsEventGroup = "live" | "upcoming" | "final" | "other";

const NO_SPORTS_PREFERENCES: SportsPreferences = {
  version: 1,
  favoriteTeams: [],
  favoriteLeagues: [],
  showOnlyFavorites: false,
};

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
    leagueId: providerIdValue(record.leagueId),
    league,
    startTime,
    homeTeamId: providerIdValue(record.homeTeamId),
    homeName,
    awayTeamId: providerIdValue(record.awayTeamId),
    awayName,
    homeBadgeUrl: httpsUrlValue(record.homeBadgeUrl),
    awayBadgeUrl: httpsUrlValue(record.awayBadgeUrl),
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
  preferences: SportsPreferences = NO_SPORTS_PREFERENCES,
): boolean {
  const favoriteLeagues = normalizedSet(preferences.favoriteLeagues);
  return (
    preferences.favoriteTeams.some(
      (team) =>
        sportsTeamMatches(team, event.homeTeamId, event.homeName) ||
        sportsTeamMatches(team, event.awayTeamId, event.awayName),
    ) || favoriteLeagues.has(normalizeName(event.league))
  );
}

/**
 * Applies the user's visibility preference before the calm status ordering.
 * With no favorites configured it intentionally retains the provider feed.
 */
export function selectSportsEvents(
  events: SportsEvent[],
  preferences: SportsPreferences = NO_SPORTS_PREFERENCES,
): SportsEvent[] {
  const hasFavorites =
    preferences.favoriteTeams.length > 0 || preferences.favoriteLeagues.length > 0;
  const visible =
    preferences.showOnlyFavorites && hasFavorites
      ? events.filter((event) => isFavoriteSportsEvent(event, preferences))
      : events;
  return sortSportsEvents(visible, preferences);
}

/**
 * One calm ribbon ordering: live, then upcoming, then final, then unavailable
 * states. Within each group, favorites lead and finals show the most recent
 * result first.
 */
export function sortSportsEvents(
  events: SportsEvent[],
  preferences: SportsPreferences = NO_SPORTS_PREFERENCES,
): SportsEvent[] {
  return [...events].sort((left, right) => {
    const groupDifference = groupRank(sportsEventGroup(left)) - groupRank(sportsEventGroup(right));
    if (groupDifference !== 0) {
      return groupDifference;
    }

    const favoriteDifference =
      favoriteSportsEventRank(left, preferences) - favoriteSportsEventRank(right, preferences);
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

/** Builds picker choices from already-normalized provider events without another network request. */
export function sportsTeamsFromEvents(events: SportsEvent[]): SportsTeamPreference[] {
  const teams = new Map<string, SportsTeamPreference>();
  for (const event of events) {
    addSportsTeam(teams, {
      id: event.awayTeamId,
      name: event.awayName,
      league: event.league,
      sport: event.sport,
      badgeUrl: event.awayBadgeUrl,
    });
    addSportsTeam(teams, {
      id: event.homeTeamId,
      name: event.homeName,
      league: event.league,
      sport: event.sport,
      badgeUrl: event.homeBadgeUrl,
    });
  }
  return [...teams.values()].sort(
    (left, right) =>
      (left.league ?? "").localeCompare(right.league ?? "") || left.name.localeCompare(right.name),
  );
}

/** Only stable numeric IDs are allowed to influence native provider requests. */
export function favoriteSportsTeamIds(preferences: SportsPreferences): string[] {
  return [...new Set(preferences.favoriteTeams.map((team) => team.id).filter(isProviderId))];
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

function favoriteSportsEventRank(event: SportsEvent, preferences: SportsPreferences): number {
  for (const [index, team] of preferences.favoriteTeams.entries()) {
    if (
      sportsTeamMatches(team, event.homeTeamId, event.homeName) ||
      sportsTeamMatches(team, event.awayTeamId, event.awayName)
    ) {
      return index;
    }
  }
  const leagueIndex = preferences.favoriteLeagues.findIndex(
    (league) => normalizeName(league) === normalizeName(event.league),
  );
  return leagueIndex === -1
    ? Number.MAX_SAFE_INTEGER
    : preferences.favoriteTeams.length + leagueIndex;
}

function sportsTeamMatches(
  preference: SportsTeamPreference,
  eventTeamId: string | undefined,
  eventTeamName: string,
): boolean {
  if (preference.id && eventTeamId) {
    return preference.id === eventTeamId;
  }
  return normalizeName(preference.name) === normalizeName(eventTeamName);
}

function addSportsTeam(teams: Map<string, SportsTeamPreference>, team: SportsTeamPreference): void {
  const key = team.id ? `id:${team.id}` : `name:${normalizeName(team.name)}`;
  if (!teams.has(key)) {
    teams.set(key, team);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function providerIdValue(value: unknown): string | undefined {
  const id = stringValue(value);
  return id && isProviderId(id) ? id : undefined;
}

function httpsUrlValue(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text || text.length > 2_048) {
    return undefined;
  }
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
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

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeName));
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function isProviderId(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{1,32}$/.test(value);
}
