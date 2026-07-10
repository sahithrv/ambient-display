import type { ProviderStatus, SceneKey, SceneLock } from "../domain/types";

/** Every remote integration is normalized before it reaches the UI. */
export interface DataProvider<T> {
  getStatus(): ProviderStatus;
  refresh(): Promise<T | null>;
  getCached(): T | null;
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
  label: string;
  timezone?: string;
}

export interface ProviderHealth {
  id: "weather" | "github" | "sports" | "calendar" | "presence" | "voice" | "wallpaper";
  label: string;
  status: ProviderStatus;
  detail: string;
}

/**
 * Non-secret input accepted by the narrow native Wallpaper Engine command.
 * `monitorIndex` controls Wallpaper Engine's target monitor only; it does not
 * position the Tauri overlay window.
 */
export interface WallpaperEngineSettingsInput {
  executablePath?: string;
  monitorIndex: number;
  playlists: Partial<Record<SceneKey, string>>;
}

/** Frontend-persisted wallpaper preferences, safe for Tauri Store/local storage. */
export interface WallpaperSettings extends WallpaperEngineSettingsInput {
  version: 1;
  playlists: Record<SceneKey, string>;
  /** Separate from Wallpaper Engine's `monitorIndex`: hosts the overlay itself. */
  overlayMonitorIndex: number;
  sceneLock: SceneLock;
  fallbackMode: "automatic" | "force-internal";
}

/** Lets the renderer switch to a calm internal scene without exposing native errors. */
export interface WallpaperFallbackState {
  active: boolean;
  mode: WallpaperSettings["fallbackMode"];
  reason?: string;
}
