import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultSportsPreferences,
  loadSportsPreferences,
  MAX_FAVORITE_SPORTS_TEAMS,
  normalizeSportsPreferences,
  saveSportsPreferences,
} from "./sportsSettings";

function localStorageFixture() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sports settings", () => {
  it("normalizes bounded team choices without retaining malformed provider IDs", () => {
    const teams = Array.from({ length: MAX_FAVORITE_SPORTS_TEAMS + 3 }, (_, index) => ({
      id: index === 0 ? "unsafe/id" : String(130_000 + index),
      name: index === 1 ? "  Golden   State  Warriors " : `Team ${index}`,
      badgeUrl: index === 2 ? "javascript:alert(1)" : undefined,
    }));
    const preferences = normalizeSportsPreferences({
      favoriteTeams: teams,
      favoriteLeagues: ["NBA", "nba", "Premier League"],
      showOnlyFavorites: true,
      secret: "must be stripped",
    });

    expect(preferences.favoriteTeams).toHaveLength(MAX_FAVORITE_SPORTS_TEAMS);
    expect(preferences.favoriteTeams[0]).toEqual({ name: "Team 0" });
    expect(preferences.favoriteTeams[1]).toMatchObject({
      id: "130001",
      name: "Golden State Warriors",
    });
    expect(preferences.favoriteTeams[2].badgeUrl).toBeUndefined();
    expect(preferences.favoriteLeagues).toEqual(["NBA", "Premier League"]);
    expect(preferences).not.toHaveProperty("secret");
  });

  it("persists only HTTPS badge URLs without embedded credentials", () => {
    const preferences = normalizeSportsPreferences({
      favoriteTeams: [
        { id: "1", name: "Secure", badgeUrl: "https://images.example.test/secure.png" },
        { id: "2", name: "Insecure", badgeUrl: "http://images.example.test/insecure.png" },
        {
          id: "3",
          name: "Credentialed",
          badgeUrl: "https://user:password@images.example.test/credentialed.png",
        },
      ],
    });

    expect(preferences.favoriteTeams[0].badgeUrl).toBe("https://images.example.test/secure.png");
    expect(preferences.favoriteTeams[1].badgeUrl).toBeUndefined();
    expect(preferences.favoriteTeams[2].badgeUrl).toBeUndefined();
  });

  it("persists only the normalized non-secret snapshot in browser preview", async () => {
    const localStorage = localStorageFixture();
    vi.stubGlobal("window", { localStorage });

    await saveSportsPreferences({
      ...createDefaultSportsPreferences(),
      favoriteTeams: [{ id: "133600", name: "Warriors", league: "NBA" }],
      showOnlyFavorites: true,
    });

    await expect(loadSportsPreferences()).resolves.toEqual({
      version: 1,
      favoriteTeams: [{ id: "133600", name: "Warriors", league: "NBA" }],
      favoriteLeagues: [],
      showOnlyFavorites: true,
    });
  });

  it("keeps deterministic preview choices separate from production settings", async () => {
    vi.stubGlobal("window", { localStorage: localStorageFixture() });
    await saveSportsPreferences(
      {
        ...createDefaultSportsPreferences(),
        favoriteTeams: [{ id: "134860", name: "Lakers" }],
        showOnlyFavorites: true,
      },
      "preview",
    );

    await expect(loadSportsPreferences("preview")).resolves.toMatchObject({
      favoriteTeams: [{ id: "134860", name: "Lakers" }],
    });
    await expect(loadSportsPreferences("production")).resolves.toEqual(
      createDefaultSportsPreferences(),
    );
  });
});
