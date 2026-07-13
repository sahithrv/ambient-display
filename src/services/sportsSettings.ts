import type { SportsPreferences, SportsTeamPreference } from "../domain";
import { isTauriRuntime } from "./tauri";

const BROWSER_STORAGE_KEY = "ambient-glass.sports-settings.v1";
const PREVIEW_STORAGE_KEY = "ambient-glass.sports-settings.preview.v1";
const STORE_FILE = "ambient-glass.json";
const STORE_KEY = "sports-settings";

export const MAX_FAVORITE_SPORTS_TEAMS = 8;
export type SportsSettingsScope = "production" | "preview";

export function createDefaultSportsPreferences(): SportsPreferences {
  return {
    version: 1,
    favoriteTeams: [],
    favoriteLeagues: [],
    showOnlyFavorites: false,
  };
}

/** Keeps the non-secret settings compact and safe before storage or native IPC. */
export function normalizeSportsPreferences(value: unknown): SportsPreferences {
  const record = asRecord(value);
  if (!record) {
    return createDefaultSportsPreferences();
  }

  const favoriteTeams: SportsTeamPreference[] = [];
  const seen = new Set<string>();
  if (Array.isArray(record.favoriteTeams)) {
    for (const candidate of record.favoriteTeams) {
      const team = normalizeTeam(candidate);
      if (!team) {
        continue;
      }
      const key = team.id ? `id:${team.id}` : `name:${normalizeName(team.name)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      favoriteTeams.push(team);
      if (favoriteTeams.length === MAX_FAVORITE_SPORTS_TEAMS) {
        break;
      }
    }
  }

  return {
    version: 1,
    favoriteTeams,
    favoriteLeagues: uniqueStrings(record.favoriteLeagues, 12, 128),
    showOnlyFavorites: record.showOnlyFavorites === true,
  };
}

export async function loadSportsPreferences(
  scope: SportsSettingsScope = "production",
): Promise<SportsPreferences> {
  const browserValue = readBrowserPreferences(scope);
  if (scope === "preview" || !isTauriRuntime()) {
    return browserValue;
  }
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { defaults: {}, autoSave: 150 });
    const nativeValue = await store.get<unknown>(STORE_KEY);
    if (nativeValue !== undefined) {
      const preferences = normalizeSportsPreferences(nativeValue);
      writeBrowserPreferences(preferences, scope);
      return preferences;
    }
  } catch {
    // Browser storage retains the last non-secret preference snapshot.
  }
  return browserValue;
}

export async function saveSportsPreferences(
  preferences: SportsPreferences,
  scope: SportsSettingsScope = "production",
): Promise<SportsPreferences> {
  const normalized = normalizeSportsPreferences(preferences);
  writeBrowserPreferences(normalized, scope);
  if (scope === "preview" || !isTauriRuntime()) {
    return normalized;
  }
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { defaults: {}, autoSave: 150 });
    await store.set(STORE_KEY, normalized);
  } catch {
    // The in-memory preference remains usable if native Store is unavailable.
  }
  return normalized;
}

function readBrowserPreferences(scope: SportsSettingsScope): SportsPreferences {
  if (typeof window === "undefined") {
    return createDefaultSportsPreferences();
  }
  try {
    const value = window.localStorage.getItem(storageKey(scope));
    return value
      ? normalizeSportsPreferences(JSON.parse(value) as unknown)
      : createDefaultSportsPreferences();
  } catch {
    return createDefaultSportsPreferences();
  }
}

function writeBrowserPreferences(preferences: SportsPreferences, scope: SportsSettingsScope): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(preferences));
  } catch {
    // A blocked/full browser store must not break the active display.
  }
}

function storageKey(scope: SportsSettingsScope): string {
  return scope === "preview" ? PREVIEW_STORAGE_KEY : BROWSER_STORAGE_KEY;
}

function normalizeTeam(value: unknown): SportsTeamPreference | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const name = safeString(record.name, 128);
  if (!name) {
    return undefined;
  }
  const id = safeString(record.id, 32);
  const badgeUrl = safeUrl(record.badgeUrl);
  return {
    name,
    ...(id && /^\d{1,32}$/.test(id) ? { id } : {}),
    ...(safeString(record.league, 128) ? { league: safeString(record.league, 128) } : {}),
    ...(safeString(record.sport, 96) ? { sport: safeString(record.sport, 96) } : {}),
    ...(badgeUrl ? { badgeUrl } : {}),
  };
}

function uniqueStrings(value: unknown, maximum: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const text = safeString(candidate, maxLength);
    const key = text ? normalizeName(text) : undefined;
    if (!text || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(text);
    if (result.length === maximum) {
      break;
    }
  }
  return result;
}

function safeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return text.length > 0 && text.length <= maxLength && !Array.from(text).some(isControlCharacter)
    ? text
    : undefined;
}

function safeUrl(value: unknown): string | undefined {
  const text = safeString(value, 2_048);
  if (!text) {
    return undefined;
  }
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
