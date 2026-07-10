import { afterEach, describe, expect, it, vi } from "vitest";

import { readProviderCache, writeProviderCache } from "./providerCache";

function localStorageFixture() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    raw: (key: string) => values.get(key),
    setRaw: (key: string, value: string) => values.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider cache", () => {
  it("round-trips only a validated value with its refresh timestamp", () => {
    const localStorage = localStorageFixture();
    vi.stubGlobal("window", { localStorage });

    writeProviderCache("github.today", { commits: 7 }, "2026-07-09T18:00:00.000Z");

    expect(
      readProviderCache(
        "github.today",
        (value): value is { commits: number } =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as { commits?: unknown }).commits === "number",
      ),
    ).toEqual({
      savedAt: "2026-07-09T18:00:00.000Z",
      value: { commits: 7 },
    });
  });

  it("rejects malformed timestamps and does not write invalid cache records", () => {
    const localStorage = localStorageFixture();
    vi.stubGlobal("window", { localStorage });
    const key = "ambient-glass.provider-cache.v1:sports.today";

    localStorage.setRaw(key, JSON.stringify({ savedAt: "not-a-date", value: [] }));
    expect(readProviderCache("sports.today", Array.isArray)).toBeNull();

    writeProviderCache("sports.today", [], "not-a-date");
    expect(localStorage.raw(key)).toBe(JSON.stringify({ savedAt: "not-a-date", value: [] }));
  });

  it("fails closed when a cached value does not pass the provider validator", () => {
    const localStorage = localStorageFixture();
    vi.stubGlobal("window", { localStorage });
    localStorage.setRaw(
      "ambient-glass.provider-cache.v1:github.today",
      JSON.stringify({ savedAt: "2026-07-09T18:00:00.000Z", value: { commits: "seven" } }),
    );

    expect(
      readProviderCache(
        "github.today",
        (value): value is { commits: number } =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as { commits?: unknown }).commits === "number",
      ),
    ).toBeNull();
  });
});
