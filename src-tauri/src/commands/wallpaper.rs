//! Narrow Tauri commands for Wallpaper Engine.
//!
//! The webview only sends a `SceneKey` enum. It cannot select an executable,
//! construct command-line flags, or pass an arbitrary wallpaper path at run time.

use tauri::{AppHandle, Manager, State};

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

/// Applies one allowlisted scene inside the app. Duplicate automatic requests
/// are suppressed. Bounded pop-out discovery runs off the IPC thread.
#[tauri::command]
pub async fn apply_wallpaper_scene(
    scene: SceneKey,
    app: AppHandle,
) -> Result<WallpaperOperationResult, CommandError> {
    run_apply(app, scene, false).await
}

/// Runs the same narrow operation as `apply_wallpaper_scene`, but deliberately
/// bypasses duplicate suppression for the settings screen's per-scene preview.
#[tauri::command]
pub async fn test_wallpaper_scene(
    scene: SceneKey,
    app: AppHandle,
) -> Result<WallpaperOperationResult, CommandError> {
    run_apply(app, scene, true).await
}

#[tauri::command]
pub fn close_in_app_wallpaper(
    controller: State<'_, WallpaperEngineController>,
) -> Result<(), CommandError> {
    controller.close_in_app()
}

async fn run_apply(
    app: AppHandle,
    scene: SceneKey,
    force: bool,
) -> Result<WallpaperOperationResult, CommandError> {
    let operation_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        operation_app
            .state::<WallpaperEngineController>()
            .apply_scene(&operation_app, scene, force)
    })
    .await
    .map_err(|_| CommandError::State {
        message: "The in-app wallpaper operation could not complete.".to_owned(),
    })?
}
