import { useCallback, useEffect, useMemo, useState, type HTMLAttributes } from "react";
import type { SceneKey, SceneLock } from "../domain";
import {
  configureWallpaperEngine,
  getDisplayMonitors,
  getWallpaperEngineStatus,
  isTauriRuntime,
  setDisplayMonitor,
  testWallpaperScene,
  type DisplayMonitorStatus,
  type WallpaperEngineStatus,
  type WallpaperSceneResult,
} from "../services/tauri";
import {
  createDefaultWallpaperSettings,
  deriveWallpaperFallback,
  loadWallpaperSettings,
  saveWallpaperSettings,
  validateWallpaperSettings,
  WALLPAPER_SCENE_KEYS,
} from "../services/wallpaperSettings";
import type { WallpaperFallbackState, WallpaperSettings } from "../services/types";

export interface WallpaperSetupProps extends HTMLAttributes<HTMLElement> {
  /** Optional outer status lets an app-level health surface stay in sync. */
  engineStatus?: WallpaperEngineStatus | null;
  /** Pass a controlled lock when the app owns scene orchestration state. */
  sceneLock?: SceneLock;
  onSceneLockChange?: (lock: SceneLock) => void;
  onFallbackChange?: (state: WallpaperFallbackState) => void;
  onEngineStatusChange?: (status: WallpaperEngineStatus) => void;
  onSettingsApplied?: (settings: WallpaperSettings) => void;
  onSceneTest?: (scene: SceneKey, result: WallpaperSceneResult) => void;
}

/**
 * Non-secret Wallpaper Engine setup. It owns a persisted settings draft and
 * only invokes the narrow native configuration/test commands exposed by the
 * Tauri bridge; no shell command, token, or arbitrary process data reaches it.
 */
export function WallpaperSetup({
  engineStatus,
  sceneLock,
  onSceneLockChange,
  onFallbackChange,
  onEngineStatusChange,
  onSettingsApplied,
  onSceneTest,
  className = "",
  ...props
}: WallpaperSetupProps) {
  const [settings, setSettings] = useState<WallpaperSettings>(createDefaultWallpaperSettings);
  const [nativeStatus, setNativeStatus] = useState<WallpaperEngineStatus | null>(
    engineStatus ?? null,
  );
  const [displayMonitors, setDisplayMonitors] = useState<DisplayMonitorStatus | null>(null);
  const [message, setMessage] = useState("Loading saved Wallpaper Engine setup…");
  const [applying, setApplying] = useState(false);
  const [testingScene, setTestingScene] = useState<SceneKey | null>(null);

  const resolvedStatus = engineStatus ?? nativeStatus;
  const resolvedLock = sceneLock ?? settings.sceneLock;
  const fallback = useMemo(
    () => deriveWallpaperFallback(settings, resolvedStatus),
    [resolvedStatus, settings],
  );

  const announceStatus = useCallback(
    (nextStatus: WallpaperEngineStatus) => {
      setNativeStatus(nextStatus);
      onEngineStatusChange?.(nextStatus);
    },
    [onEngineStatusChange],
  );

  const refreshDisplayMonitors = useCallback(async () => {
    if (!isTauriRuntime()) {
      return;
    }
    const result = await getDisplayMonitors();
    if (result.ok) {
      setDisplayMonitors(result.value);
    }
  }, []);

  const persistOnly = useCallback(
    async (next: WallpaperSettings) => {
      const saved = await saveWallpaperSettings(next);
      setSettings(saved);
      onSettingsApplied?.(saved);
      return saved;
    },
    [onSettingsApplied],
  );

  const applySettings = useCallback(
    async (next: WallpaperSettings, quiet = false): Promise<boolean> => {
      const validation = validateWallpaperSettings(next);
      if (!validation.valid) {
        setMessage(validation.message ?? "Wallpaper settings need attention.");
        return false;
      }

      setApplying(true);
      const saved = await persistOnly(next);
      onSceneLockChange?.(saved.sceneLock);
      if (!isTauriRuntime()) {
        setApplying(false);
        if (!quiet) {
          setMessage("Saved locally. Apply this configuration from the native Windows app.");
        }
        return true;
      }

      const result = await configureWallpaperEngine({
        executablePath: saved.executablePath,
        monitorIndex: saved.monitorIndex,
        playlists: saved.playlists,
      });
      if (!result.ok) {
        setApplying(false);
        setMessage(result.message);
        return false;
      }
      announceStatus(result.value);
      const monitorResult = await setDisplayMonitor(saved.overlayMonitorIndex);
      setApplying(false);
      if (!monitorResult.ok) {
        setMessage(monitorResult.message);
        return false;
      }
      setDisplayMonitors(monitorResult.value);
      if (!quiet) {
        setMessage(`${result.value.message} ${monitorResult.value.message}`);
      }
      return true;
    },
    [announceStatus, onSceneLockChange, persistOnly],
  );

  useEffect(() => {
    onFallbackChange?.(fallback);
  }, [fallback, onFallbackChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshDisplayMonitors(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshDisplayMonitors]);

  useEffect(() => {
    let cancelled = false;
    void loadWallpaperSettings().then((saved) => {
      if (cancelled) {
        return;
      }
      setSettings(saved);
      onSceneLockChange?.(saved.sceneLock);
      void applySettings(saved, true).then((applied) => {
        if (!cancelled) {
          setMessage(
            applied
              ? isTauriRuntime()
                ? "Saved Wallpaper Engine setup applied."
                : "Saved local setup is ready for the native Windows app."
              : "Saved Wallpaper Engine setup needs attention.",
          );
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [applySettings, onSceneLockChange]);

  const updateSettings = (update: (current: WallpaperSettings) => WallpaperSettings) => {
    setSettings((current) => update(current));
  };

  const updateLock = (lock: SceneLock) => {
    const next = { ...settings, sceneLock: lock };
    setSettings(next);
    onSceneLockChange?.(lock);
    void persistOnly(next);
  };

  const updateFallbackMode = (fallbackMode: WallpaperSettings["fallbackMode"]) => {
    const next = { ...settings, fallbackMode };
    setSettings(next);
    void persistOnly(next);
  };

  const refreshStatus = async () => {
    if (!isTauriRuntime()) {
      setMessage("Wallpaper Engine status is available in the native Windows app.");
      return;
    }
    const result = await getWallpaperEngineStatus();
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    announceStatus(result.value);
    await refreshDisplayMonitors();
    setMessage(result.value.message);
  };

  const testScene = async (scene: SceneKey) => {
    const applied = await applySettings(settings, true);
    if (!applied) {
      return;
    }
    setTestingScene(scene);
    const result = await testWallpaperScene(scene);
    setTestingScene(null);
    setMessage(result.message);
    onSceneTest?.(scene, result);
    if (isTauriRuntime()) {
      const status = await getWallpaperEngineStatus();
      if (status.ok) {
        announceStatus(status.value);
      }
    }
  };

  const restoreDefaults = () => {
    const next = createDefaultWallpaperSettings();
    setSettings(next);
    onSceneLockChange?.(next.sceneLock);
    void applySettings(next);
  };

  return (
    <section
      {...props}
      className={`wallpaper-setup ${className}`}
      aria-labelledby="wallpaper-setup-title"
    >
      <div className="wallpaper-setup__header">
        <div>
          <p className="app-settings__eyebrow" id="wallpaper-setup-title">
            Wallpaper Engine setup
          </p>
          <span>Non-secret local preferences; native validation is always applied again.</span>
        </div>
        <i
          aria-label={
            resolvedStatus?.available ? "Wallpaper Engine ready" : "Wallpaper Engine fallback"
          }
          className={`wallpaper-setup__state ${
            resolvedStatus?.available ? "is-ready" : fallback.active ? "is-fallback" : ""
          }`}
        />
      </div>

      <form
        className="wallpaper-setup__form"
        onSubmit={(event) => {
          event.preventDefault();
          void applySettings(settings);
        }}
      >
        <label className="wallpaper-setup__path">
          <span>Wallpaper Engine executable (optional)</span>
          <input
            autoComplete="off"
            onChange={(event) =>
              updateSettings((current) => ({
                ...current,
                executablePath: event.target.value.trim() || undefined,
              }))
            }
            placeholder="Auto-detect Steam installation"
            value={settings.executablePath ?? ""}
          />
        </label>
        <label className="wallpaper-setup__monitor">
          <span>Wallpaper Engine monitor</span>
          <input
            aria-describedby="wallpaper-monitor-help"
            max={15}
            min={0}
            onChange={(event) =>
              updateSettings((current) => ({
                ...current,
                monitorIndex: Number(event.target.value),
              }))
            }
            type="number"
            value={settings.monitorIndex}
          />
        </label>
        <p className="wallpaper-setup__help" id="wallpaper-monitor-help">
          This changes Wallpaper Engine&apos;s playlist target only; it does not move the Ambient
          Glass app window.
        </p>
        <label className="wallpaper-setup__overlay-monitor">
          <span>Ambient Glass window display</span>
          <select
            aria-describedby="overlay-monitor-help"
            onChange={(event) =>
              updateSettings((current) => ({
                ...current,
                overlayMonitorIndex: Number(event.target.value),
              }))
            }
            value={settings.overlayMonitorIndex}
          >
            {(displayMonitors?.monitors.length
              ? displayMonitors.monitors
              : [{ index: settings.overlayMonitorIndex, width: 0, height: 0, selected: true }]
            ).map((monitor) => (
              <option key={monitor.index} value={monitor.index}>
                {monitor.name ?? `Display ${monitor.index + 1}`}
                {monitor.width > 0 ? ` · ${monitor.width} × ${monitor.height}` : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="wallpaper-setup__help" id="overlay-monitor-help">
          Save &amp; apply moves the regular Ambient Glass window to this display.
        </p>

        <label className="wallpaper-setup__lock">
          <span>Scene selection</span>
          <select
            onChange={(event) => {
              const nextLock: SceneLock =
                event.target.value === "automatic"
                  ? { mode: "automatic" }
                  : { mode: "locked", sceneKey: event.target.value as SceneKey };
              updateLock(nextLock);
            }}
            value={resolvedLock.mode === "locked" ? resolvedLock.sceneKey : "automatic"}
          >
            <option value="automatic">Automatic weather and time</option>
            {WALLPAPER_SCENE_KEYS.map((scene) => (
              <option key={scene} value={scene}>
                Lock to {sceneLabel(scene)}
              </option>
            ))}
          </select>
        </label>
        <label className="wallpaper-setup__fallback">
          <input
            checked={settings.fallbackMode === "force-internal"}
            onChange={(event) =>
              updateFallbackMode(event.target.checked ? "force-internal" : "automatic")
            }
            type="checkbox"
          />
          <span>Use the calm internal fallback instead of Wallpaper Engine</span>
        </label>

        <div className="wallpaper-setup__playlist-header">
          <strong>Scene playlists</strong>
          <span>Each scene is safe to test independently.</span>
        </div>
        <div className="wallpaper-setup__playlists">
          {WALLPAPER_SCENE_KEYS.map((scene) => (
            <label className="wallpaper-setup__playlist" key={scene}>
              <span>{sceneLabel(scene)}</span>
              <input
                aria-label={`${sceneLabel(scene)} playlist`}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    playlists: { ...current.playlists, [scene]: event.target.value },
                  }))
                }
                value={settings.playlists[scene]}
              />
              <button
                className="glass-action glass-action--quiet"
                disabled={applying || testingScene !== null}
                onClick={() => void testScene(scene)}
                type="button"
              >
                {testingScene === scene ? "Testing…" : "Test"}
              </button>
            </label>
          ))}
        </div>

        <div className="wallpaper-setup__actions">
          <button className="glass-action glass-action--primary" disabled={applying} type="submit">
            {applying ? "Applying…" : "Save & apply"}
          </button>
          <button
            className="glass-action glass-action--quiet"
            disabled={applying}
            onClick={restoreDefaults}
            type="button"
          >
            Restore defaults
          </button>
          <button
            className="glass-action glass-action--quiet"
            disabled={applying}
            onClick={() => void refreshStatus()}
            type="button"
          >
            Check connection
          </button>
        </div>
      </form>
      <p className="wallpaper-setup__message" role="status">
        {message}
      </p>
    </section>
  );
}

function sceneLabel(scene: SceneKey): string {
  return scene.replace(".", " · ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
