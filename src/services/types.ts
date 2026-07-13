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

/** Non-secret input accepted by the narrow native Wallpaper Engine command. */
export interface WallpaperEngineSettingsInput {
  executablePath?: string;
  /** Default Wallpaper Engine project/video rendered behind the app UI. */
  wallpaperFile?: string;
  /** Optional weather/time overrides; missing scenes use `wallpaperFile`. */
  wallpaperFiles: Partial<Record<SceneKey, string>>;
}

/** Frontend-persisted wallpaper preferences, safe for Tauri Store/local storage. */
export interface WallpaperSettings extends WallpaperEngineSettingsInput {
  version: 2;
  /** Selects which display hosts the regular Ambient Glass app window. */
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
