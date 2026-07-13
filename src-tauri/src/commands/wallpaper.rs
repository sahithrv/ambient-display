//! Narrow Tauri commands for Wallpaper Engine.
//!
//! The webview only sends a `SceneKey` enum. It cannot select an executable,
//! construct command-line flags, or pass an arbitrary wallpaper path at run time.

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::wallpaper::{
    CommandError, SceneKey, WallpaperEngineController, WallpaperEngineStatus,
    WallpaperImportResult, WallpaperLibraryController, WallpaperLibrarySnapshot,
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
pub async fn configure_wallpaper_engine(
    settings: WallpaperSettingsInput,
    app: AppHandle,
) -> Result<WallpaperEngineStatus, CommandError> {
    let operation_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        operation_app
            .state::<WallpaperEngineController>()
            .configure(settings)
    })
    .await
    .map_err(|_| CommandError::State {
        message: "The Wallpaper Engine configuration could not complete.".to_owned(),
    })?
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
pub async fn close_in_app_wallpaper(app: AppHandle) -> Result<(), CommandError> {
    let operation_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        operation_app
            .state::<WallpaperEngineController>()
            .close_in_app()
    })
    .await
    .map_err(|_| CommandError::State {
        message: "The in-app wallpaper could not close safely.".to_owned(),
    })?
}

/// Lists only validated files already copied into Ambient Glass's app-local
/// library. Source paths are never retained by the native layer.
#[tauri::command]
pub async fn list_wallpaper_library(
    app: AppHandle,
) -> Result<WallpaperLibrarySnapshot, CommandError> {
    let operation_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        operation_app
            .state::<WallpaperLibraryController>()
            .list(&operation_app)
    })
    .await
    .map_err(|_| CommandError::State {
        message: "The wallpaper library scan could not complete.".to_owned(),
    })?
}

/// Opens the operating system picker and copies its result without ever
/// exposing source paths to the webview. Each file is signature-checked,
/// content-addressed, and deduplicated inside the managed library.
#[tauri::command]
pub async fn pick_and_import_wallpapers(
    app: AppHandle,
) -> Result<Option<WallpaperImportResult>, CommandError> {
    let picker_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        picker_app
            .dialog()
            .file()
            .set_title("Add wallpapers to Ambient Glass")
            .add_filter(
                "Wallpaper images and videos",
                &["jpg", "jpeg", "png", "webp", "mp4", "webm"],
            )
            .blocking_pick_files()
    })
    .await
    .map_err(|_| CommandError::State {
        message: "The wallpaper picker could not complete.".to_owned(),
    })?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let paths = picked
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return Ok(None);
    }

    let operation_app = app.clone();
    let imported = tauri::async_runtime::spawn_blocking(move || {
        operation_app
            .state::<WallpaperLibraryController>()
            .import(&operation_app, paths)
    })
    .await
    .map_err(|_| CommandError::State {
        message: "The wallpaper import could not complete.".to_owned(),
    })??;
    Ok(Some(imported))
}

/// Removes one content-addressed app-owned copy. The identifier cannot contain
/// path separators or traversal components.
#[tauri::command]
pub async fn delete_wallpaper_asset(
    id: String,
    app: AppHandle,
) -> Result<WallpaperLibrarySnapshot, CommandError> {
    let operation_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        operation_app
            .state::<WallpaperLibraryController>()
            .delete(&operation_app, &id)
    })
    .await
    .map_err(|_| CommandError::State {
        message: "The wallpaper removal could not complete.".to_owned(),
    })?
}

/// Opens the fixed app-local library directory in the operating-system file
/// browser. The webview cannot choose another path for this command.
#[tauri::command]
pub fn reveal_wallpaper_library(app: AppHandle) -> Result<(), CommandError> {
    app.state::<WallpaperLibraryController>().reveal(&app)
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
