//! Tauri commands for the one Ambient Glass overlay window.

use tauri::{AppHandle, State};

use crate::windowing::{
    DisplayMonitorStatus, DisplayWindowMode, DisplayWindowState, WindowCommandResult,
    WindowingError,
};

/// Shows the initially-hidden transparent window only after the frontend has
/// rendered its first stable frame, preventing a startup flash.
#[tauri::command]
pub fn mark_overlay_ready(
    app: AppHandle,
    state: State<'_, DisplayWindowState>,
) -> Result<WindowCommandResult, WindowingError> {
    state.mark_ready(&app)
}

/// Applies pointer-event behavior for the central display state machine.
#[tauri::command]
pub fn set_display_window_mode(
    mode: DisplayWindowMode,
    app: AppHandle,
    state: State<'_, DisplayWindowState>,
) -> Result<WindowCommandResult, WindowingError> {
    state.set_mode(&app, mode)
}

/// Exits the normal desktop application explicitly. The same action is
/// available through the standard title-bar close button.
#[tauri::command]
pub fn quit_application(app: AppHandle) {
    app.exit(0);
}

/// Retrieves the last mode successfully applied by the native window hook.
#[tauri::command]
pub fn get_display_window_state(
    state: State<'_, DisplayWindowState>,
) -> Result<WindowCommandResult, WindowingError> {
    state.snapshot()
}

/// Returns only display labels, dimensions, and the currently selected overlay
/// target. This allows settings to choose a monitor without exposing arbitrary
/// window positioning to the webview.
#[tauri::command]
pub fn get_display_monitors(
    app: AppHandle,
    state: State<'_, DisplayWindowState>,
) -> Result<DisplayMonitorStatus, WindowingError> {
    state.monitor_status(&app)
}

/// Moves the fullscreen overlay to one platform-reported monitor index. The
/// index is validated natively against the current monitor list.
#[tauri::command]
pub fn set_display_monitor(
    monitor_index: u8,
    app: AppHandle,
    state: State<'_, DisplayWindowState>,
) -> Result<DisplayMonitorStatus, WindowingError> {
    state.set_monitor(&app, monitor_index)
}
