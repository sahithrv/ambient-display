import { normalizeSportsEvent, type CalendarEvent, type SportsEvent } from "../domain";
import type { DataProvider } from "./types";
import type { ProviderStatus } from "../domain/types";
import { readProviderCache, writeProviderCache } from "./providerCache";
import { invokeTauri, invokeTauriResult } from "./tauri";

export interface GitHubToday {
  commits: number;
  countedByGitHub: true;
}

type NativeProviderMode = "native" | "live" | "mock" | "unconfigured";

interface GitHubNativeResponse {
  count?: number;
  commits?: number;
  mode: NativeProviderMode;
  stale: boolean;
  message: string;
}

interface SportsNativeResponse {
  mode: NativeProviderMode;
  events: SportsEvent[];
  stale: boolean;
  message: string;
}

interface GoogleCalendarNativeResponse {
  events: CalendarEvent[];
  stale: boolean;
  message: string;
}

interface GithubCachePayload {
  localDay: string;
  commits: number;
}

interface SportsCachePayload {
  localDay: string;
  favoriteTeamIds?: string[];
  events: SportsEvent[];
}

export interface CachedProviderData<T> {
  savedAt: string;
  value: T;
}

const GITHUB_CACHE_KEY = "github.today";
const SPORTS_CACHE_KEY = "sports.today";
const MAX_CACHED_SPORTS_EVENTS = 64;
const MAX_FAVORITE_TEAM_IDS = 8;

/**
 * These caches deliberately retain only normalized, display-safe data. They
 * never contain a token, a raw provider payload, or a contribution calendar
 * that the GitHub boundary does not actually provide.
 */
export function readCachedGithubToday(localDay: string): CachedProviderData<GitHubToday> | null {
  if (!isLocalDay(localDay)) {
    return null;
  }
  const cached = readProviderCache(GITHUB_CACHE_KEY, isGithubCachePayload);
  if (!cached || cached.value.localDay !== localDay) {
    return null;
  }
  return {
    savedAt: cached.savedAt,
    value: { commits: cached.value.commits, countedByGitHub: true },
  };
}

export function readCachedSportsEvents(
  localDay: string,
  favoriteTeamIds: readonly string[] = [],
): CachedProviderData<SportsEvent[]> | null {
  if (!isLocalDay(localDay)) {
    return null;
  }
  const cached = readProviderCache(SPORTS_CACHE_KEY, isSportsCachePayload);
  const requestedIds = normalizeFavoriteTeamIds(favoriteTeamIds);
  if (
    !cached ||
    cached.value.localDay !== localDay ||
    selectionKey(cached.value.favoriteTeamIds ?? []) !== selectionKey(requestedIds)
  ) {
    return null;
  }
  const events = normalizeSportsEvents(cached.value.events);
  if (!events) {
    return null;
  }
  return { savedAt: cached.savedAt, value: events };
}

/** Tokens remain in Stronghold/native storage; this adapter has no token field. */
export class GitHubDesktopProvider implements DataProvider<GitHubToday> {
  private status: ProviderStatus = { state: "needs-auth", message: "Connect GitHub in settings" };
  private cached: GitHubToday | null = null;
  private cachedAt: string | undefined;

  public constructor(private readonly localDay?: string) {
    const cached = localDay ? readCachedGithubToday(localDay) : null;
    if (cached) {
      this.cached = cached.value;
      this.cachedAt = cached.savedAt;
      this.status = staleStatus("GitHub", cached.savedAt);
    }
  }

  public getStatus(): ProviderStatus {
    return this.status;
  }

  public getCached(): GitHubToday | null {
    return this.cached;
  }

  public async refresh(localDay?: string): Promise<GitHubToday | null> {
    this.status = {
      state: "loading",
      lastUpdated: this.cachedAt,
    };
    const result = await invokeTauri<GitHubNativeResponse>("get_github_commits", { localDay });
    const commits = result?.commits ?? result?.count;
    if (result && isLiveProviderMode(result.mode) && isCommitCount(commits)) {
      this.cached = { commits, countedByGitHub: true };
      if (!result.stale) {
        this.cachedAt = new Date().toISOString();
        const day = cacheDay(localDay, this.localDay);
        if (day) {
          writeProviderCache<GithubCachePayload>(
            GITHUB_CACHE_KEY,
            { localDay: day, commits },
            this.cachedAt,
          );
        }
      }
      this.status = {
        state: result.stale ? "stale" : "ready",
        lastUpdated: this.cachedAt,
        message: result.message,
      };
      return this.cached;
    }
    this.status = this.cached
      ? staleStatus("GitHub", this.cachedAt)
      : { state: "needs-auth", message: "Connect GitHub in secure desktop settings" };
    return this.cached;
  }
}

/** TheSportsDB stays replaceable because only normalized events leave this boundary. */
export class SportsDesktopProvider implements DataProvider<SportsEvent[]> {
  private status: ProviderStatus = {
    state: "needs-auth",
    message: "Sports provider not connected",
  };
  private cached: SportsEvent[] | null = null;
  private cachedAt: string | undefined;
  private favoriteTeamIds: string[];

  public constructor(
    private readonly localDay?: string,
    favoriteTeamIds: readonly string[] = [],
  ) {
    this.favoriteTeamIds = normalizeFavoriteTeamIds(favoriteTeamIds);
    const cached = localDay ? readCachedSportsEvents(localDay, this.favoriteTeamIds) : null;
    if (cached) {
      this.cached = cached.value;
      this.cachedAt = cached.savedAt;
      this.status = staleStatus("sports", cached.savedAt);
    }
  }

  public getStatus(): ProviderStatus {
    return this.status;
  }

  public getCached(): SportsEvent[] | null {
    return this.cached;
  }

  public async refresh(
    localDay?: string,
    favoriteTeamIds: readonly string[] = this.favoriteTeamIds,
  ): Promise<SportsEvent[] | null> {
    const requestedIds = normalizeFavoriteTeamIds(favoriteTeamIds);
    if (selectionKey(requestedIds) !== selectionKey(this.favoriteTeamIds)) {
      this.favoriteTeamIds = requestedIds;
      this.cached = null;
      this.cachedAt = undefined;
    }
    this.status = {
      state: "loading",
      lastUpdated: this.cachedAt,
    };
    const invocation = await invokeTauriResult<SportsNativeResponse>("refresh_sports", {
      localDay,
      favoriteTeamIds: requestedIds,
    });
    const result = invocation.ok ? invocation.value : null;
    const events = result ? normalizeSportsEvents(result.events) : null;
    if (result && events && isLiveProviderMode(result.mode)) {
      this.cached = events;
      if (!result.stale) {
        this.cachedAt = new Date().toISOString();
        const day = cacheDay(localDay, this.localDay);
        if (day) {
          writeProviderCache<SportsCachePayload>(
            SPORTS_CACHE_KEY,
            { localDay: day, favoriteTeamIds: requestedIds, events },
            this.cachedAt,
          );
        }
      }
      this.status = {
        state: result.stale ? "stale" : "ready",
        lastUpdated: this.cachedAt,
        message: result.message,
      };
      return events;
    }
    this.status = this.cached
      ? {
          state: "stale",
          lastUpdated: this.cachedAt,
          message: invocation.ok
            ? "TheSportsDB returned invalid events; using cached sports data."
            : `${invocation.message} Using cached sports data.`,
        }
      : invocation.ok
        ? { state: "needs-auth", message: "Sports provider not connected" }
        : { state: "error", message: invocation.message };
    return this.cached;
  }
}

/** Local reminders always work. This optional bridge reads Google only after OAuth is connected natively. */
export class GoogleCalendarDesktopProvider implements DataProvider<CalendarEvent[]> {
  private status: ProviderStatus = { state: "needs-auth", message: "Using local calendar" };
  private cached: CalendarEvent[] | null = null;
  private cachedAt: string | undefined;

  public constructor(private readonly localDay?: string) {}

  public getStatus(): ProviderStatus {
    return this.status;
  }

  public getCached(): CalendarEvent[] | null {
    return this.cached;
  }

  public async refresh(localDay?: string): Promise<CalendarEvent[] | null> {
    this.status = {
      state: "loading",
      lastUpdated: this.cachedAt,
    };
    const requestedLocalDay = localDay ?? this.localDay;
    const result = await invokeTauriResult<GoogleCalendarNativeResponse>(
      "get_google_calendar_today",
      {
        localDay: requestedLocalDay,
      },
    );
    const events = result.ok ? normalizeGoogleCalendarEvents(result.value.events) : null;
    if (result.ok && events) {
      this.cached = events;
      if (!result.value.stale) {
        this.cachedAt = new Date().toISOString();
      }
      this.status = {
        state: result.value.stale ? "stale" : "ready",
        lastUpdated: this.cachedAt,
        message: result.value.message,
      };
      return events;
    }
    this.status = this.cached
      ? {
          state: "stale",
          lastUpdated: this.cachedAt,
          message: result.ok
            ? "Google Calendar returned invalid events; using this session’s cache."
            : `${result.message} Using this session’s cache.`,
        }
      : {
          state: "needs-auth",
          message: result.ok ? "Google Calendar returned invalid events." : result.message,
        };
    return this.cached;
  }
}

function normalizeGoogleCalendarEvents(value: unknown): CalendarEvent[] | null {
  if (!Array.isArray(value) || value.length > 64) {
    return null;
  }
  const events: CalendarEvent[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.title !== "string" ||
      typeof record.startsAt !== "string" ||
      typeof record.allDay !== "boolean" ||
      record.source !== "google" ||
      !isCalendarStart(record.startsAt, record.allDay) ||
      (record.endsAt !== undefined &&
        (typeof record.endsAt !== "string" || !isCalendarStart(record.endsAt, record.allDay))) ||
      (record.externalId !== undefined && typeof record.externalId !== "string")
    ) {
      return null;
    }
    events.push({
      id: record.id,
      title: record.title,
      startsAt: record.startsAt,
      endsAt: record.endsAt as string | undefined,
      allDay: record.allDay,
      source: "google",
      externalId: record.externalId as string | undefined,
    });
  }
  return events;
}

function isCalendarStart(value: string, allDay: boolean): boolean {
  return allDay ? /^\d{4}-\d{2}-\d{2}$/.test(value) : Number.isFinite(Date.parse(value));
}

function cacheDay(
  requestedLocalDay: string | undefined,
  constructorLocalDay: string | undefined,
): string | undefined {
  const localDay = requestedLocalDay ?? constructorLocalDay;
  return localDay && isLocalDay(localDay) ? localDay : undefined;
}

function isLiveProviderMode(mode: NativeProviderMode): boolean {
  return mode === "native" || mode === "live";
}

function isCommitCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isLocalDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function staleStatus(provider: string, savedAt: string | undefined): ProviderStatus {
  return {
    state: "stale",
    lastUpdated: savedAt,
    message: savedAt
      ? `Showing cached ${provider} data from ${savedAt}.`
      : `Showing cached ${provider} data.`,
  };
}

function isGithubCachePayload(value: unknown): value is GithubCachePayload {
  if (!isRecord(value)) {
    return false;
  }
  return isLocalDay(value.localDay) && isCommitCount(value.commits);
}

function isSportsCachePayload(value: unknown): value is SportsCachePayload {
  if (!isRecord(value) || !isLocalDay(value.localDay) || !Array.isArray(value.events)) {
    return false;
  }
  return (
    (value.favoriteTeamIds === undefined ||
      (Array.isArray(value.favoriteTeamIds) &&
        value.favoriteTeamIds.length <= MAX_FAVORITE_TEAM_IDS &&
        value.favoriteTeamIds.every(isFavoriteTeamId))) &&
    value.events.length <= MAX_CACHED_SPORTS_EVENTS &&
    value.events.every((event) => normalizeSportsEvent(event) !== undefined)
  );
}

function normalizeFavoriteTeamIds(values: readonly string[]): string[] {
  return [...new Set(values.filter(isFavoriteTeamId))].slice(0, MAX_FAVORITE_TEAM_IDS).sort();
}

function isFavoriteTeamId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,32}$/.test(value);
}

function selectionKey(values: readonly string[]): string {
  return normalizeFavoriteTeamIds(values).join(",");
}

function normalizeSportsEvents(value: unknown): SportsEvent[] | null {
  if (!Array.isArray(value) || value.length > MAX_CACHED_SPORTS_EVENTS) {
    return null;
  }
  const events = value
    .map((event) => normalizeSportsEvent(event))
    .filter((event): event is SportsEvent => event !== undefined);
  return events.length === value.length ? events : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
