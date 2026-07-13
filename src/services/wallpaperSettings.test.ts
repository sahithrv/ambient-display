import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultWallpaperSettings,
  deriveWallpaperFallback,
  loadWallpaperSettings,
  normalizeWallpaperSettings,
  saveWallpaperSettings,
  validateWallpaperSettings,
} from "./wallpaperSettings";

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

describe("wallpaper settings", () => {
  it("keeps only safe persisted wallpaper fields and known scene keys", () => {
    const settings = normalizeWallpaperSettings({
      executablePath: "C:\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe",
      overlayMonitorIndex: 2,
      wallpaperFile: "C:\\Steam\\steamapps\\workshop\\content\\431960\\123456\\project.json",
      wallpaperFiles: {
        "clear.day": "D:\\Wallpapers\\clear.mp4",
        "storm.any": "D:\\Wallpapers\\bad.exe",
        unknown: "D:\\Wallpapers\\ignored.mp4",
      },
      sceneLock: { mode: "locked", sceneKey: "clear.day" },
      fallbackMode: "force-internal",
    });

    expect(settings).toMatchObject({
      executablePath: "C:\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe",
      overlayMonitorIndex: 2,
      version: 2,
      sceneLock: { mode: "locked", sceneKey: "clear.day" },
      fallbackMode: "force-internal",
    });
    expect(settings.wallpaperFile).toContain("project.json");
    expect(settings.wallpaperFiles["clear.day"]).toContain("clear.mp4");
    expect(settings.wallpaperFiles["storm.any"]).toBeUndefined();
  });

  it("validates the browser draft before it reaches the native command", () => {
    const valid = createDefaultWallpaperSettings();
    const invalid = {
      ...valid,
      wallpaperFile: "C:\\unsafe.exe",
    };

    expect(validateWallpaperSettings(valid)).toEqual({ valid: true });
    expect(validateWallpaperSettings(invalid)).toMatchObject({ valid: false });
  });

  it("persists non-secret settings in browser fallback storage", async () => {
    const localStorage = localStorageFixture();
    vi.stubGlobal("window", { localStorage });
    const settings = {
      ...createDefaultWallpaperSettings(),
      wallpaperFile: "D:\\Wallpapers\\rain.mp4",
      sceneLock: { mode: "locked" as const, sceneKey: "rain.night" as const },
    };

    await saveWallpaperSettings(settings);

    await expect(loadWallpaperSettings()).resolves.toMatchObject({
      wallpaperFile: "D:\\Wallpapers\\rain.mp4",
      sceneLock: { mode: "locked", sceneKey: "rain.night" },
    });
  });

  it("emits a renderer-safe fallback state without a native error payload", () => {
    const automatic = {
      ...createDefaultWallpaperSettings(),
      wallpaperFile: "D:\\Wallpapers\\rain.mp4",
    };
    const unavailable = deriveWallpaperFallback(
      automatic,
      { available: false, message: "Wallpaper Engine was not found." },
      true,
    );
    const forced = deriveWallpaperFallback(
      { ...automatic, fallbackMode: "force-internal" },
      null,
      false,
    );

    expect(unavailable).toEqual({
      active: true,
      mode: "automatic",
      reason: "Wallpaper Engine was not found.",
    });
    expect(forced.active).toBe(true);
    expect(forced.reason).toBe("Internal fallback selected in settings.");
  });
});
