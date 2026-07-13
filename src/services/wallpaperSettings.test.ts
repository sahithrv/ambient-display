import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultWallpaperSettings,
  deriveWallpaperFallback,
  reconcileWallpaperSettingsWithLibrary,
  loadWallpaperSettings,
  normalizeWallpaperSettings,
  saveWallpaperSettings,
  validateWallpaperSettings,
  withImportedWallpapersEnabled,
  withWallpaperSourceMode,
} from "./wallpaperSettings";

const firstId = "a".repeat(64);
const secondId = "b".repeat(64);

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
      version: 2,
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
      version: 3,
      sourceMode: "internal",
      sceneLock: { mode: "locked", sceneKey: "clear.day" },
      fallbackMode: "force-internal",
    });
    expect(settings.wallpaperFile).toContain("project.json");
    expect(settings.wallpaperFiles["clear.day"]).toContain("clear.mp4");
    expect(settings.wallpaperFiles["storm.any"]).toBeUndefined();
  });

  it("migrates v2 fallback and empty setups into explicit v3 sources", () => {
    expect(
      normalizeWallpaperSettings({ version: 2, fallbackMode: "force-internal" }),
    ).toMatchObject({ version: 3, sourceMode: "internal", fallbackMode: "force-internal" });
    expect(normalizeWallpaperSettings({ version: 2 })).toMatchObject({
      version: 3,
      sourceMode: "library",
      fallbackMode: "automatic",
    });
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
      sourceMode: "wallpaper-engine" as const,
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

  it("normalizes library preferences and reconciles removed assets", () => {
    const settings = normalizeWallpaperSettings({
      version: 3,
      sourceMode: "library",
      library: {
        playbackMode: "single",
        selectedId: firstId,
        enabledIds: [firstId, firstId, secondId, "unsafe"],
        shuffleIntervalMinutes: 30,
      },
    });
    expect(settings.library).toEqual({
      playbackMode: "single",
      selectedId: firstId,
      enabledIds: [firstId, secondId],
      shuffleIntervalMinutes: 30,
    });

    const reconciled = reconcileWallpaperSettingsWithLibrary(settings, {
      items: [
        {
          id: secondId,
          displayName: "Second",
          kind: "image",
          mimeType: "image/png",
          sizeBytes: 1,
          importedAt: "2026-07-12T00:00:00.000Z",
          filePath: "managed",
        },
      ],
    });
    expect(reconciled.library.enabledIds).toEqual([secondId]);
    expect(reconciled.library.selectedId).toBe(secondId);
  });

  it("keeps source mode and the compatibility fallback flag in sync", () => {
    const settings = createDefaultWallpaperSettings();
    expect(withWallpaperSourceMode(settings, "internal")).toMatchObject({
      sourceMode: "internal",
      fallbackMode: "force-internal",
    });
    expect(withWallpaperSourceMode(settings, "wallpaper-engine")).toMatchObject({
      sourceMode: "wallpaper-engine",
      fallbackMode: "automatic",
    });
  });

  it("enables successful imports and switches to the local library", () => {
    const settings = withWallpaperSourceMode(createDefaultWallpaperSettings(), "internal");
    const imported = withImportedWallpapersEnabled(settings, [firstId, secondId, "unsafe"]);
    expect(imported).toMatchObject({
      sourceMode: "library",
      fallbackMode: "automatic",
      library: {
        selectedId: firstId,
        enabledIds: [firstId, secondId],
      },
    });
  });

  it("uses the internal scene only when a library has no usable media", () => {
    const settings = createDefaultWallpaperSettings();
    expect(deriveWallpaperFallback(settings, null, false, false).active).toBe(true);
    expect(deriveWallpaperFallback(settings, null, false, true).active).toBe(false);
  });
});
