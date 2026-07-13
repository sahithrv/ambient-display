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

export type WallpaperSourceMode = "library" | "wallpaper-engine" | "internal";

export type WallpaperPlaybackMode = "single" | "shuffle";

export type WallpaperMediaKind = "image" | "video";

export interface WallpaperLibraryPreferences {
  playbackMode: WallpaperPlaybackMode;
  selectedId?: string;
  enabledIds: string[];
  shuffleIntervalMinutes: number;
}

/** Native metadata for a validated copy inside Ambient Glass's local data directory. */
export interface NativeWallpaperLibraryItem {
  id: string;
  displayName: string;
  kind: WallpaperMediaKind;
  mimeType: string;
  sizeBytes: number;
  importedAt: string;
  /** Bridge-only destination. Never persist, display, or log this value. */
  filePath: string;
}

export interface NativeWallpaperLibrarySnapshot {
  items: NativeWallpaperLibraryItem[];
  totalBytes: number;
  ignoredCount: number;
}

export type WallpaperImportFailureReason = "unsupported" | "tooLarge" | "unreadable" | "copyFailed";

export interface WallpaperImportFailure {
  displayName: string;
  reason: WallpaperImportFailureReason;
}

export interface WallpaperImportResult {
  library: NativeWallpaperLibrarySnapshot;
  importedIds: string[];
  duplicateIds: string[];
  rejected: WallpaperImportFailure[];
}

/** Renderer-safe library item. `src` is an asset URL or bundled preview URL. */
export interface WallpaperLibraryItem extends Omit<NativeWallpaperLibraryItem, "filePath"> {
  src: string;
  preview: boolean;
}

export interface WallpaperLibraryState {
  items: WallpaperLibraryItem[];
  totalBytes: number;
  ignoredCount: number;
  native: boolean;
}

/** Frontend-persisted wallpaper preferences, safe for Tauri Store/local storage. */
export interface WallpaperSettings extends WallpaperEngineSettingsInput {
  version: 3;
  sourceMode: WallpaperSourceMode;
  /** Selects which display hosts the regular Ambient Glass app window. */
  overlayMonitorIndex: number;
  sceneLock: SceneLock;
  library: WallpaperLibraryPreferences;
  /** Compatibility alias for the existing settings UI; v3 sourceMode is authoritative. */
  fallbackMode: "automatic" | "force-internal";
}

/** Lets the renderer switch to a calm internal scene without exposing native errors. */
export interface WallpaperFallbackState {
  active: boolean;
  mode: WallpaperSettings["fallbackMode"];
  reason?: string;
}
