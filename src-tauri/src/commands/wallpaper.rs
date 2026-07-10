//! Narrow Tauri commands for Wallpaper Engine.
//!
//! The webview only sends a `SceneKey` enum. It cannot select an executable,
//! construct command-line flags, or pass arbitrary playlist text at run time.

use tauri::State;

use crate::wallpaper::{
    CommandError, SceneKey, WallpaperEngineController, WallpaperEngineStatus,
    WallpaperOperationResult, WallpaperSettingsInput,
};

/// Returns the platform-aware control status for the settings surface.
#[tauri::command]
pub fn get_wallpaper_engine_status(
    controller: State<'_, WallpaperEngineController>,
) -> Result<WallpaperEngineStatus, CommandError> {
    controller.status()
}

/// Updates the in-memory, non-secret Wallpaper Engine configuration after native
/// validation. The frontend owns persistence in Tauri Store and sends its saved
/// snapshot on launch; this command never writes arbitrary files.
#[tauri::command]
pub fn configure_wallpaper_engine(
    settings: WallpaperSettingsInput,
    controller: State<'_, WallpaperEngineController>,
) -> Result<WallpaperEngineStatus, CommandError> {
    controller.configure(settings)
}

/// Applies one allowlisted scene. Duplicate automatic requests are suppressed.
#[tauri::command]
pub fn apply_wallpaper_scene(
    scene: SceneKey,
    controller: State<'_, WallpaperEngineController>,
) -> Result<WallpaperOperationResult, CommandError> {
    controller.apply_scene(scene, false)
}

/// Runs the same narrow operation as `apply_wallpaper_scene`, but deliberately
/// bypasses duplicate suppression for the settings screen's per-playlist test.
#[tauri::command]
pub fn test_wallpaper_scene(
    scene: SceneKey,
    controller: State<'_, WallpaperEngineController>,
) -> Result<WallpaperOperationResult, CommandError> {
    controller.apply_scene(scene, true)
}
