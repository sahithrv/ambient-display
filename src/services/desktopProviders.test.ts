import { afterEach, describe, expect, it, vi } from "vitest";

import type { SportsEvent } from "../domain";
import { readCachedSportsEvents, SportsDesktopProvider } from "./desktopProviders";
import { writeProviderCache } from "./providerCache";

const { invokeTauriResultMock } = vi.hoisted(() => ({
  invokeTauriResultMock: vi.fn(),
}));

vi.mock("./tauri", () => ({
  invokeTauri: vi.fn(),
  invokeTauriResult: invokeTauriResultMock,
}));

function localStorageFixture() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

const event: SportsEvent = {
  id: "fixture",
  sport: "Basketball",
  leagueId: "4387",
  league: "NBA",
  startTime: "2026-07-12T19:00:00Z",
  homeTeamId: "133600",
  homeName: "Warriors",
  awayTeamId: "134860",
  awayName: "Lakers",
  status: "scheduled",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("desktop sports cache", () => {
  it("scopes cached schedules to the selected team IDs without treating order as meaningful", () => {
    vi.stubGlobal("window", { localStorage: localStorageFixture() });
    writeProviderCache(
      "sports.today",
      {
        localDay: "2026-07-12",
        favoriteTeamIds: ["133600", "134860"],
        events: [event],
      },
      "2026-07-12T18:00:00Z",
    );

    expect(readCachedSportsEvents("2026-07-12", ["134860", "133600"])?.value).toEqual([event]);
    expect(readCachedSportsEvents("2026-07-12", ["133600"])).toBeNull();
  });

  it("surfaces a native refresh limit without relabeling it as disconnected", async () => {
    vi.stubGlobal("window", { localStorage: localStorageFixture() });
    invokeTauriResultMock.mockResolvedValue({
      ok: false,
      message: "Sports refresh is cooling down. Try again in about a minute.",
    });
    const provider = new SportsDesktopProvider("2026-07-12", ["133600"]);

    await expect(provider.refresh("2026-07-12", ["133600"])).resolves.toBeNull();
    expect(provider.getStatus()).toEqual({
      state: "error",
      message: "Sports refresh is cooling down. Try again in about a minute.",
    });
  });

  it("preserves selected-team cache as stale when a native refresh is rate limited", async () => {
    vi.stubGlobal("window", { localStorage: localStorageFixture() });
    writeProviderCache(
      "sports.today",
      { localDay: "2026-07-12", favoriteTeamIds: ["133600"], events: [event] },
      "2026-07-12T18:00:00Z",
    );
    invokeTauriResultMock.mockResolvedValue({
      ok: false,
      message: "Sports refresh is cooling down. Try again in about a minute.",
    });
    const provider = new SportsDesktopProvider("2026-07-12", ["133600"]);

    await expect(provider.refresh("2026-07-12", ["133600"])).resolves.toEqual([event]);
    expect(provider.getStatus()).toMatchObject({
      state: "stale",
      message:
        "Sports refresh is cooling down. Try again in about a minute. Using cached sports data.",
    });
  });
});
