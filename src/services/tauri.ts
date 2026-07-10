import type { WallpaperEngineSettingsInput } from "./types";

export type NativeShortcutAction = "toggle" | "interactive" | "debug" | "settings";

/**
 * Every native shortcut is emitted only after the native window operation has
 * completed. `visible` is especially important for the toggle shortcut: it
 * lets React follow the native result instead of trying to guess which side
 * toggled first.
 */
export interface NativeShortcutEvent {
  action: NativeShortcutAction;
  visible: boolean;
}

export type TauriInvocation<T> = { ok: true; value: T } | { ok: false; message: string };

export interface WallpaperEngineStatus {
  adapter: "native" | "mock";
  available: boolean;
  hasConfiguredPath: boolean;
  monitorIndex: number;
  playlistCount: number;
  message: string;
}

export interface WallpaperSceneResult {
  applied: boolean;
  /** The native controller already has this scene, so no child was launched. */
  duplicate: boolean;
  mocked: boolean;
  message: string;
}

export interface DisplayMonitor {
  index: number;
  name?: string;
  width: number;
  height: number;
  selected: boolean;
}

export interface DisplayMonitorStatus {
  monitors: DisplayMonitor[];
  selectedMonitorIndex?: number;
  message: string;
}

/**
 * Narrow browser-safe Tauri bridge. Callers that need to distinguish a native
 * rejection from an unavailable browser preview should use this result form.
 */
export async function invokeTauriResult<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TauriInvocation<T>> {
  if (!isTauriRuntime()) {
    return { ok: false, message: "This action is available in the native desktop app." };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return { ok: true, value: await invoke<T>(command, args) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The native action could not be completed.",
    };
  }
}

/** Browser callers retain the convenient mock-safe nullable shape. */
export async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const result = await invokeTauriResult<T>(command, args);
  return result.ok ? result.value : null;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Receives globally registered native shortcut events. Dynamic import keeps
 * browser screenshots and ordinary Vite development independent of Tauri.
 */
export async function listenForNativeShortcuts(
  onShortcut: (shortcut: NativeShortcutEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<{ action?: string; visible?: unknown }>(
      "ambient-glass://shortcut",
      ({ payload }) => {
        if (
          payload.action === "toggle" ||
          payload.action === "interactive" ||
          payload.action === "debug" ||
          payload.action === "settings"
        ) {
          // Refuse an old or malformed event rather than desynchronizing the
          // state machine from the actual native visibility result.
          if (typeof payload.visible === "boolean") {
            onShortcut({ action: payload.action, visible: payload.visible });
          }
        }
      },
    );
  } catch {
    return () => undefined;
  }
}

export async function applyWallpaperScene(
  scene: string,
  test = false,
): Promise<WallpaperSceneResult> {
  const command = test ? "test_wallpaper_scene" : "apply_wallpaper_scene";
  const result = await invokeTauriResult<WallpaperSceneResult>(command, { scene });
  if (result.ok) {
    return result.value;
  }
  return {
    applied: false,
    duplicate: false,
    mocked: false,
    message: isTauriRuntime()
      ? result.message
      : "Preview mock: Wallpaper Engine control is available on Windows only.",
  };
}

export async function getWallpaperEngineStatus(): Promise<TauriInvocation<WallpaperEngineStatus>> {
  return invokeTauriResult<WallpaperEngineStatus>("get_wallpaper_engine_status");
}

/**
 * Applies only non-secret, validated Wallpaper Engine settings. Persistence is
 * deliberately owned by the frontend's Tauri Store/local fallback, then this
 * narrow command receives the complete snapshot after startup or a save.
 */
export async function configureWallpaperEngine(
  settings: WallpaperEngineSettingsInput,
): Promise<TauriInvocation<WallpaperEngineStatus>> {
  return invokeTauriResult<WallpaperEngineStatus>("configure_wallpaper_engine", { settings });
}

export async function testWallpaperScene(scene: string): Promise<WallpaperSceneResult> {
  return applyWallpaperScene(scene, true);
}

/** Reads only platform display labels and dimensions for the settings picker. */
export async function getDisplayMonitors(): Promise<TauriInvocation<DisplayMonitorStatus>> {
  return invokeTauriResult<DisplayMonitorStatus>("get_display_monitors");
}

/** Moves the fullscreen overlay to one native-validated monitor index. */
export async function setDisplayMonitor(
  monitorIndex: number,
): Promise<TauriInvocation<DisplayMonitorStatus>> {
  return invokeTauriResult<DisplayMonitorStatus>("set_display_monitor", { monitorIndex });
}

export async function setNativeWindowMode(mode: string): Promise<void> {
  await invokeTauri("set_display_window_mode", { mode });
}

/** Uses the same explicit app exit as the standard title-bar close button. */
export async function quitNativeApplication(): Promise<void> {
  await invokeTauri("quit_application");
}
