import type { HTMLAttributes } from "react";
import type {
  WallpaperLibraryItem,
  WallpaperLibraryPreferences,
  WallpaperPlaybackMode,
  WallpaperSourceMode,
} from "../services/types";

export interface WallpaperLibraryProps extends HTMLAttributes<HTMLElement> {
  items: WallpaperLibraryItem[];
  preferences: WallpaperLibraryPreferences;
  activeId?: string;
  sourceMode?: WallpaperSourceMode;
  nativeAvailable?: boolean;
  ready?: boolean;
  busy?: boolean;
  totalBytes?: number;
  message?: string;
  onSourceModeChange?: (mode: WallpaperSourceMode) => void;
  onPlaybackModeChange?: (mode: WallpaperPlaybackMode) => void;
  onIntervalChange?: (minutes: number) => void;
  onSelectWallpaper?: (id: string) => void;
  onToggleEnabled?: (id: string, enabled: boolean) => void;
  onDelete?: (id: string) => void;
  onImport?: () => void;
  onReveal?: () => void;
}

/** Controlled settings gallery for app-owned wallpaper media. */
export function WallpaperLibrary({
  items,
  preferences,
  activeId,
  sourceMode,
  nativeAvailable = false,
  ready = true,
  busy = false,
  totalBytes = 0,
  message,
  onSourceModeChange,
  onPlaybackModeChange,
  onIntervalChange,
  onSelectWallpaper,
  onToggleEnabled,
  onDelete,
  onImport,
  onReveal,
  className = "",
  ...props
}: WallpaperLibraryProps) {
  const enabled = new Set(preferences.enabledIds);
  const controlsDisabled = busy || !ready;
  const libraryControlsDisabled = controlsDisabled || sourceMode !== "library";
  const intervalOptions = Array.from(
    new Set([5, 15, 30, 60, 120, 240, preferences.shuffleIntervalMinutes]),
  ).sort((left, right) => left - right);

  return (
    <section
      {...props}
      className={`wallpaper-library ${className}`}
      aria-labelledby="wallpaper-library-title"
    >
      <header className="wallpaper-library__header">
        <div>
          <p className="app-settings__eyebrow">Wallpaper library</p>
          <h3 id="wallpaper-library-title">Your atmosphere, kept locally</h3>
          <p>
            Imported media is copied into Ambient Glass, so moving the original will not break it.
          </p>
        </div>
        <div className="wallpaper-library__header-actions">
          <button
            className="glass-action glass-action--primary"
            disabled={controlsDisabled || !nativeAvailable || !onImport}
            onClick={onImport}
            type="button"
          >
            {!ready ? "Loading…" : busy ? "Adding…" : "Add wallpapers"}
          </button>
          <button
            className="glass-action glass-action--quiet"
            disabled={controlsDisabled || !nativeAvailable || !onReveal}
            onClick={onReveal}
            type="button"
          >
            Open folder
          </button>
        </div>
      </header>

      {sourceMode ? (
        <div className="wallpaper-library__source" aria-label="Wallpaper source">
          <SourceButton
            active={sourceMode === "library"}
            disabled={controlsDisabled}
            label="My wallpapers"
            mode="library"
            onChange={onSourceModeChange}
          />
          <SourceButton
            active={sourceMode === "wallpaper-engine"}
            disabled={controlsDisabled}
            label="Wallpaper Engine"
            mode="wallpaper-engine"
            onChange={onSourceModeChange}
          />
          <SourceButton
            active={sourceMode === "internal"}
            disabled={controlsDisabled}
            label="Calm fallback"
            mode="internal"
            onChange={onSourceModeChange}
          />
        </div>
      ) : null}

      <div className="wallpaper-library__playback">
        <div className="wallpaper-library__mode" aria-label="Wallpaper playback">
          <button
            aria-pressed={preferences.playbackMode === "shuffle"}
            className={preferences.playbackMode === "shuffle" ? "is-active" : ""}
            disabled={libraryControlsDisabled}
            onClick={() => onPlaybackModeChange?.("shuffle")}
            type="button"
          >
            Shuffle selected
          </button>
          <button
            aria-pressed={preferences.playbackMode === "single"}
            className={preferences.playbackMode === "single" ? "is-active" : ""}
            disabled={libraryControlsDisabled}
            onClick={() => onPlaybackModeChange?.("single")}
            type="button"
          >
            Keep one
          </button>
        </div>
        <label>
          <span>Change every</span>
          <select
            disabled={libraryControlsDisabled || preferences.playbackMode !== "shuffle"}
            onChange={(event) => onIntervalChange?.(Number(event.target.value))}
            value={preferences.shuffleIntervalMinutes}
          >
            {intervalOptions.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {items.length > 0 ? (
        <div className="wallpaper-library__grid">
          {items.map((item) => {
            const isActive = activeId === item.id;
            return (
              <article
                className={`wallpaper-library__item${isActive ? " is-active" : ""}`}
                key={item.id}
              >
                <button
                  aria-label={`Use ${item.displayName} now`}
                  aria-pressed={isActive}
                  className="wallpaper-library__preview"
                  disabled={controlsDisabled}
                  onClick={() => onSelectWallpaper?.(item.id)}
                  type="button"
                >
                  {item.kind === "video" ? (
                    <video muted playsInline preload="metadata" src={item.src} />
                  ) : (
                    <img alt="" decoding="async" loading="lazy" src={item.src} />
                  )}
                  <span className="wallpaper-library__kind">{item.kind}</span>
                  {isActive ? <span className="wallpaper-library__active">Showing now</span> : null}
                </button>
                <div className="wallpaper-library__item-copy">
                  <strong title={item.displayName}>{item.displayName}</strong>
                  <span>{formatBytes(item.sizeBytes)}</span>
                </div>
                <div className="wallpaper-library__item-actions">
                  <label>
                    <input
                      aria-label={`${enabled.has(item.id) ? "Exclude" : "Include"} ${item.displayName} ${enabled.has(item.id) ? "from" : "in"} shuffle`}
                      checked={enabled.has(item.id)}
                      disabled={libraryControlsDisabled}
                      onChange={(event) => onToggleEnabled?.(item.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span>Shuffle</span>
                  </label>
                  {!item.preview ? (
                    <button
                      aria-label={`Remove ${item.displayName}`}
                      disabled={controlsDisabled || !onDelete}
                      onClick={() => onDelete?.(item.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="wallpaper-library__empty">
          <strong>Add a calm image or video</strong>
          <span>JPG, PNG, WebP, MP4, and WebM files are supported.</span>
        </div>
      )}

      <footer className="wallpaper-library__footer">
        <span>
          {items.length} {items.length === 1 ? "wallpaper" : "wallpapers"}
          {totalBytes > 0 ? ` · ${formatBytes(totalBytes)} stored locally` : ""}
        </span>
        <span role="status">
          {message ??
            (nativeAvailable
              ? "Choose one wallpaper or include several in the shuffle."
              : "Preview library · import is available in the desktop app.")}
        </span>
      </footer>
    </section>
  );
}

interface SourceButtonProps {
  active: boolean;
  disabled: boolean;
  label: string;
  mode: WallpaperSourceMode;
  onChange?: (mode: WallpaperSourceMode) => void;
}

function SourceButton({ active, disabled, label, mode, onChange }: SourceButtonProps) {
  return (
    <button
      aria-pressed={active}
      className={active ? "is-active" : ""}
      disabled={disabled}
      onClick={() => onChange?.(mode)}
      type="button"
    >
      {label}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Bundled preview";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
