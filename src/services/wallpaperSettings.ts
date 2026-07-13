import type { SceneKey, SceneLock } from "../domain";
import { isTauriRuntime } from "./tauri";
import type { WallpaperFallbackState, WallpaperSettings } from "./types";

const BROWSER_STORAGE_KEY = "ambient-glass.wallpaper-settings.v1";
const STORE_FILE = "ambient-glass.json";
const STORE_KEY = "wallpaper-settings";

export const WALLPAPER_SCENE_KEYS = [
  "clear.dawn",
  "clear.day",
  "clear.sunset",
  "clear.night",
  "cloudy.day",
  "cloudy.night",
  "rain.day",
  "rain.night",
  "storm.any",
  "fog.any",
  "snow.any",
  "fallback.any",
] as const satisfies readonly SceneKey[];

export interface WallpaperSettingsValidation {
  valid: boolean;
  message?: string;
}

export function createDefaultWallpaperSettings(): WallpaperSettings {
  return {
    version: 2,
    overlayMonitorIndex: 0,
    wallpaperFiles: {},
    sceneLock: { mode: "automatic" },
    fallbackMode: "automatic",
  };
}

/** Drops malformed persisted fields rather than passing them to a native command. */
export function normalizeWallpaperSettings(value: unknown): WallpaperSettings {
  const defaults = createDefaultWallpaperSettings();
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }

  const executablePath = stringValue(record.executablePath);
  const overlayMonitorIndex =
    integerInRange(record.overlayMonitorIndex, 0, 15) ?? defaults.overlayMonitorIndex;
  const wallpaperFile = stringValue(record.wallpaperFile);
  const storedWallpaperFiles = asRecord(record.wallpaperFiles);
  const wallpaperFiles: Partial<Record<SceneKey, string>> = {};
  for (const scene of WALLPAPER_SCENE_KEYS) {
    const file = storedWallpaperFiles ? stringValue(storedWallpaperFiles[scene]) : undefined;
    if (file && isSafeWallpaperFile(file)) {
      wallpaperFiles[scene] = file;
    }
  }

  return {
    version: 2,
    executablePath: executablePath && isSafePathValue(executablePath) ? executablePath : undefined,
    wallpaperFile: wallpaperFile && isSafeWallpaperFile(wallpaperFile) ? wallpaperFile : undefined,
    overlayMonitorIndex,
    wallpaperFiles,
    sceneLock: normalizeSceneLock(record.sceneLock),
    fallbackMode: record.fallbackMode === "force-internal" ? "force-internal" : "automatic",
  };
}

export function validateWallpaperSettings(
  settings: WallpaperSettings,
): WallpaperSettingsValidation {
  if (
    !Number.isInteger(settings.overlayMonitorIndex) ||
    settings.overlayMonitorIndex < 0 ||
    settings.overlayMonitorIndex > 15
  ) {
    return { valid: false, message: "Choose an overlay display index from 0 through 15." };
  }
  if (settings.executablePath && !isSafePathValue(settings.executablePath)) {
    return { valid: false, message: "Wallpaper Engine path is invalid." };
  }
  if (settings.wallpaperFile && !isSafeWallpaperFile(settings.wallpaperFile)) {
    return {
      valid: false,
      message: "Choose a supported Wallpaper Engine project, scene, web, or video file.",
    };
  }
  for (const [scene, file] of Object.entries(settings.wallpaperFiles)) {
    if (!isSceneKey(scene) || !file || !isSafeWallpaperFile(file)) {
      return {
        valid: false,
        message: `Wallpaper file for ${scene} is invalid or unsupported.`,
      };
    }
  }
  return { valid: true };
}

/** Browser storage remains a safe fallback if the Tauri Store plugin is unavailable. */
export async function loadWallpaperSettings(): Promise<WallpaperSettings> {
  const browserValue = readBrowserSettings();
  if (!isTauriRuntime()) {
    return browserValue;
  }
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { defaults: {}, autoSave: 150 });
    const nativeValue = await store.get<unknown>(STORE_KEY);
    if (nativeValue !== undefined) {
      const settings = normalizeWallpaperSettings(nativeValue);
      writeBrowserSettings(settings);
      return settings;
    }
  } catch {
    // The browser cache preserves a non-secret local configuration when Store fails.
  }
  return browserValue;
}

export async function saveWallpaperSettings(
  settings: WallpaperSettings,
): Promise<WallpaperSettings> {
  const normalized = normalizeWallpaperSettings(settings);
  writeBrowserSettings(normalized);
  if (!isTauriRuntime()) {
    return normalized;
  }
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { defaults: {}, autoSave: 150 });
    await store.set(STORE_KEY, normalized);
  } catch {
    // The in-memory/native apply path still has a browser-backed setting snapshot.
  }
  return normalized;
}

/** This state is intentionally render-safe: it contains no path or provider detail. */
export function deriveWallpaperFallback(
  settings: WallpaperSettings,
  native: { available: boolean; message: string } | null,
  nativeRuntime = isTauriRuntime(),
): WallpaperFallbackState {
  if (settings.fallbackMode === "force-internal") {
    return {
      active: true,
      mode: settings.fallbackMode,
      reason: "Internal fallback selected in settings.",
    };
  }
  if (!settings.wallpaperFile && Object.keys(settings.wallpaperFiles).length === 0) {
    return {
      active: true,
      mode: settings.fallbackMode,
      reason: "Choose an in-app Wallpaper Engine file in settings.",
    };
  }
  if (nativeRuntime && native && !native.available) {
    return { active: true, mode: settings.fallbackMode, reason: native.message };
  }
  return { active: false, mode: settings.fallbackMode };
}

function readBrowserSettings(): WallpaperSettings {
  if (typeof window === "undefined") {
    return createDefaultWallpaperSettings();
  }
  try {
    const value = window.localStorage.getItem(BROWSER_STORAGE_KEY);
    return value
      ? normalizeWallpaperSettings(JSON.parse(value) as unknown)
      : createDefaultWallpaperSettings();
  } catch {
    return createDefaultWallpaperSettings();
  }
}

function writeBrowserSettings(settings: WallpaperSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full or unavailable browser store must not block the desktop configuration.
  }
}

function normalizeSceneLock(value: unknown): SceneLock {
  const record = asRecord(value);
  if (record?.mode === "locked" && isSceneKey(record.sceneKey)) {
    return { mode: "locked", sceneKey: record.sceneKey };
  }
  return { mode: "automatic" };
}

function isSceneKey(value: unknown): value is SceneKey {
  return typeof value === "string" && (WALLPAPER_SCENE_KEYS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function integerInRange(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function isSafePathValue(value: string): boolean {
  return value === value.trim() && value.length <= 1_024 && !hasControlCharacter(value);
}

function isSafeWallpaperFile(value: string): boolean {
  if (value !== value.trim() || value.length === 0 || value.length > 1_024) {
    return false;
  }
  if (hasControlCharacter(value)) {
    return false;
  }
  const normalized = value.toLocaleLowerCase();
  return (
    normalized.endsWith("project.json") ||
    normalized.endsWith(".pkg") ||
    normalized.endsWith(".mp4") ||
    normalized.endsWith(".webm") ||
    normalized.endsWith(".html")
  );
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
