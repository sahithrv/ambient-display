//! Native window policy for Ambient Glass's single desktop window.
//!
//! The frontend owns the display state machine. The native boundary keeps the
//! window a conventional, always-recoverable application: it stays in the
//! taskbar, has standard window controls, and never consumes the desktop via a
//! fullscreen click-through overlay.

use std::{fmt, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const MAIN_WINDOW_LABEL: &str = "main";
const SHORTCUT_EVENT: &str = "ambient-glass://shortcut";

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DisplayWindowMode {
    Booting,
    Sleep,
    Ambient,
    Awakening,
    Glance,
    Interactive,
    Alarm,
    Celebration,
    Settings,
}

impl DisplayWindowMode {
    const fn click_through(self) -> bool {
        // The app used to behave as a desktop-sized overlay. Retaining this
        // field in the IPC result preserves the existing frontend contract,
        // while a regular app window must always receive its own input.
        let _ = self;
        false
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCommandResult {
    pub mode: DisplayWindowMode,
    pub ready: bool,
    pub visible: bool,
    pub click_through: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WindowingError {
    Unavailable { message: String },
    Native { message: String },
    State { message: String },
}

impl fmt::Display for WindowingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable { message } | Self::Native { message } | Self::State { message } => {
                formatter.write_str(message)
            }
        }
    }
}

impl std::error::Error for WindowingError {}

#[derive(Clone, Copy)]
struct WindowStateSnapshot {
    mode: DisplayWindowMode,
    ready: bool,
    visible: bool,
    selected_monitor_index: Option<u8>,
}

impl Default for WindowStateSnapshot {
    fn default() -> Self {
        Self {
            mode: DisplayWindowMode::Booting,
            ready: false,
            visible: false,
            selected_monitor_index: None,
        }
    }
}

/// Managed state is deliberately limited to native effects, not application
/// logic. The React state machine remains the product source of truth.
pub struct DisplayWindowState {
    state: Mutex<WindowStateSnapshot>,
}

#[derive(Default)]
pub struct InputActivityMonitor;

/// A redacted display descriptor for the settings surface. Monitor names are
/// useful labels only; no window contents, EDID data, or platform handles
/// cross the webview boundary.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMonitor {
    pub index: u8,
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub selected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMonitorStatus {
    pub monitors: Vec<DisplayMonitor>,
    pub selected_monitor_index: Option<u8>,
    pub message: String,
}

impl Default for DisplayWindowState {
    fn default() -> Self {
        Self {
            state: Mutex::new(WindowStateSnapshot::default()),
        }
    }
}

impl InputActivityMonitor {
    /// Retained as a no-op lifecycle value for compatibility with the existing
    /// app setup. A normal desktop window does not need an always-running
    /// Windows input poller just to recover from click-through mode.
    pub fn start(app: AppHandle) -> Result<Self, WindowingError> {
        let _ = app;
        Ok(Self::default())
    }

    /// Kept idempotent so the native lifecycle remains uniform.
    pub fn stop(&self) {}
}

impl Drop for InputActivityMonitor {
    fn drop(&mut self) {
        self.stop();
    }
}

impl DisplayWindowState {
    pub fn mark_ready(&self, app: &AppHandle) -> Result<WindowCommandResult, WindowingError> {
        let window = main_window(app)?;
        let mut state = self.lock()?;

        // The frontend invokes this once after its first rendered frame. A
        // shortcut may beat that request, however, and its hide/show result is
        // a stronger user intent than the startup reveal. Keep this command
        // idempotent so it can never re-show an explicitly hidden overlay.
        if state.ready {
            return Ok(as_result(*state));
        }

        apply_mode(&window, state.mode)?;
        window
            .show()
            .map_err(|_| native_error("The app window could not be shown."))?;

        state.ready = true;
        state.visible = true;
        Ok(as_result(*state))
    }

    pub fn set_mode(
        &self,
        app: &AppHandle,
        mode: DisplayWindowMode,
    ) -> Result<WindowCommandResult, WindowingError> {
        let window = main_window(app)?;
        apply_mode(&window, mode)?;

        // Alarms are safety-critical relative to the ambient experience: an
        // active alarm must restore a manually hidden app window rather than wait
        // for the next global shortcut.
        if matches!(mode, DisplayWindowMode::Alarm) {
            window
                .show()
                .map_err(|_| native_error("The alarm window could not be shown."))?;
            window
                .set_focus()
                .map_err(|_| native_error("The alarm window could not be focused."))?;
        }

        let mut state = self.lock()?;
        state.mode = mode;
        state.visible = window.is_visible().unwrap_or(state.visible);
        Ok(as_result(*state))
    }

    pub fn snapshot(&self) -> Result<WindowCommandResult, WindowingError> {
        Ok(as_result(*self.lock()?))
    }

    /// Moves the regular application window to one concrete monitor. The
    /// webview never supplies coordinates: it selects only a bounded index
    /// from the platform-provided monitor list. The current window size is
    /// preserved and centered on the chosen display rather than restoring a
    /// fullscreen overlay.
    pub fn set_monitor(
        &self,
        app: &AppHandle,
        monitor_index: u8,
    ) -> Result<DisplayMonitorStatus, WindowingError> {
        let window = main_window(app)?;
        let monitors = available_monitors(&window)?;
        let monitor = monitors
            .get(usize::from(monitor_index))
            .ok_or_else(|| WindowingError::State {
                message: "That display is no longer available. Refresh settings and choose another display."
                    .to_owned(),
            })?;

        let was_visible = window
            .is_visible()
            .map_err(|_| native_error("The app window visibility could not be checked."))?;
        let was_fullscreen = window
            .is_fullscreen()
            .map_err(|_| native_error("The app window fullscreen state could not be checked."))?;
        let previous_position = window
            .outer_position()
            .map_err(|_| native_error("The app window position could not be checked."))?;
        let previous_size = window
            .outer_size()
            .map_err(|_| native_error("The app window size could not be checked."))?;

        let move_result = (|| -> Result<(), WindowingError> {
            window.set_fullscreen(false).map_err(|_| {
                native_error("The app window could not leave fullscreen to change display.")
            })?;
            let target_size = monitor.size();
            let x_offset = i64::from(target_size.width.saturating_sub(previous_size.width)) / 2;
            let y_offset = i64::from(target_size.height.saturating_sub(previous_size.height)) / 2;
            let position = tauri::PhysicalPosition::new(
                i64::from(monitor.position().x).saturating_add(x_offset) as i32,
                i64::from(monitor.position().y).saturating_add(y_offset) as i32,
            );
            window
                .set_position(position)
                .map_err(|_| native_error("The app window could not move to the selected display."))
        })();

        if let Err(error) = move_result {
            // A monitor may disappear during a hot-plug or a platform window
            // operation can fail after fullscreen was released. Best-effort
            // restoration preserves the user's prior display rather than
            // knowingly leaving a partial window behind.
            restore_window_after_monitor_failure(
                &window,
                previous_position,
                previous_size,
                was_fullscreen,
                was_visible,
            );
            return Err(error);
        }

        if was_visible {
            window.show().map_err(|_| {
                native_error("The app window could not return after changing display.")
            })?;
        } else {
            window.hide().map_err(|_| {
                native_error(
                    "The app window visibility could not be restored after changing display.",
                )
            })?;
        }

        self.lock()?.selected_monitor_index = Some(monitor_index);
        self.monitor_status(app)
    }

    pub fn monitor_status(&self, app: &AppHandle) -> Result<DisplayMonitorStatus, WindowingError> {
        let window = main_window(app)?;
        let selected_monitor_index = self.lock()?.selected_monitor_index;
        let monitors = available_monitors(&window)?
            .iter()
            .enumerate()
            .filter_map(|(index, monitor)| {
                let index = u8::try_from(index).ok()?;
                Some(DisplayMonitor {
                    index,
                    name: monitor.name().map(ToOwned::to_owned),
                    width: monitor.size().width,
                    height: monitor.size().height,
                    selected: selected_monitor_index == Some(index),
                })
            })
            .collect();

        Ok(DisplayMonitorStatus {
            monitors,
            selected_monitor_index,
            message: "Select the display that should host the Ambient Glass app window.".to_owned(),
        })
    }

    /// A native shortcut has directly established the user's visibility
    /// intent, so it also completes the startup-ready handshake. This prevents
    /// a subsequently queued `mark_overlay_ready` command from overriding a
    /// hide pressed during startup.
    fn note_shortcut_visibility(
        &self,
        visible: bool,
    ) -> Result<WindowCommandResult, WindowingError> {
        let mut state = self.lock()?;
        state.ready = true;
        state.visible = visible;
        Ok(as_result(*state))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, WindowStateSnapshot>, WindowingError> {
        self.state.lock().map_err(|_| WindowingError::State {
            message: "The overlay state is temporarily unavailable.".to_owned(),
        })
    }
}

pub fn prepare_main_window(app: &AppHandle) -> Result<(), WindowingError> {
    let window = main_window(app)?;
    window
        .set_always_on_top(false)
        .map_err(|_| native_error("The app window could not leave always-on-top mode."))?;
    // Config starts hidden so the normal window is only revealed after its
    // first stable application frame has been painted.
    window
        .set_ignore_cursor_events(false)
        .map_err(|_| native_error("The app window could not receive pointer input."))?;
    window
        .hide()
        .map_err(|_| native_error("The app window could not start hidden."))?;
    Ok(())
}

/// Register fixed native shortcuts rather than granting the webview permission
/// to register arbitrary global keys. Shortcut conflicts are non-fatal: the
/// conventional window controls always remain available for exit and recovery.
pub fn register_shortcuts(app: &AppHandle) -> Result<(), WindowingError> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        use tauri_plugin_global_shortcut::{
            Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
        };

        let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;
        let toggle = Shortcut::new(Some(modifiers), Code::Space);
        let interactive = Shortcut::new(Some(modifiers), Code::KeyI);
        let debug = Shortcut::new(Some(modifiers), Code::KeyD);
        let settings = Shortcut::new(Some(modifiers), Code::Comma);

        let toggle_for_handler = toggle;
        let interactive_for_handler = interactive;
        let debug_for_handler = debug;
        let settings_for_handler = settings;

        if app
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |handle, shortcut, event| {
                        if event.state != ShortcutState::Pressed {
                            return;
                        }

                        let shortcut_event = if shortcut == &toggle_for_handler {
                            // React receives the resulting visibility rather than
                            // guessing whether this invocation hid or showed the
                            // window. Do not emit a state-changing event if the
                            // native operation itself failed.
                            toggle_main_window_visibility(handle)
                                .ok()
                                .map(|result| ShortcutEvent::new("toggle", result.visible))
                        } else if shortcut == &interactive_for_handler {
                            reveal_main_window(handle, DisplayWindowMode::Interactive)
                                .ok()
                                .map(|result| ShortcutEvent::new("interactive", result.visible))
                        } else if shortcut == &debug_for_handler {
                            reveal_main_window(handle, DisplayWindowMode::Interactive)
                                .ok()
                                .map(|result| ShortcutEvent::new("debug", result.visible))
                        } else if shortcut == &settings_for_handler {
                            reveal_main_window(handle, DisplayWindowMode::Settings)
                                .ok()
                                .map(|result| ShortcutEvent::new("settings", result.visible))
                        } else {
                            None
                        };

                        if let Some(shortcut_event) = shortcut_event {
                            let _ = handle.emit(SHORTCUT_EVENT, shortcut_event);
                        }
                    })
                    .build(),
            )
            .is_err()
        {
            log::warn!("Global shortcut support could not be initialized.");
            return Ok(());
        }

        for (label, shortcut) in [
            ("Ctrl+Shift+Space", toggle),
            ("Ctrl+Shift+I", interactive),
            ("Ctrl+Shift+D", debug),
            ("Ctrl+Shift+Comma", settings),
        ] {
            if app.global_shortcut().register(shortcut).is_err() {
                log::warn!("Global shortcut {label} is unavailable.");
            }
        }
    }

    Ok(())
}

#[derive(Clone, Serialize)]
struct ShortcutEvent {
    action: &'static str,
    visible: bool,
}

impl ShortcutEvent {
    const fn new(action: &'static str, visible: bool) -> Self {
        Self { action, visible }
    }
}

fn toggle_main_window_visibility(app: &AppHandle) -> Result<WindowCommandResult, WindowingError> {
    let window = main_window(app)?;
    let window_state = app.state::<DisplayWindowState>();
    // Hold the same lock used by `mark_ready` across the native window change.
    // Without this, a startup-ready call could observe `ready = false` after
    // `hide()` but before the shortcut records that deliberate user intent.
    let mut state = window_state.lock()?;
    let visible = window
        .is_visible()
        .map_err(|_| native_error("The app window visibility could not be checked."))?;

    if visible {
        window
            .hide()
            .map_err(|_| native_error("The app window could not be hidden."))?;
    } else {
        window
            .show()
            .map_err(|_| native_error("The app window could not be shown."))?;
    }

    state.ready = true;
    state.visible = !visible;
    Ok(as_result(*state))
}

fn reveal_main_window(
    app: &AppHandle,
    mode: DisplayWindowMode,
) -> Result<WindowCommandResult, WindowingError> {
    // The display machine keeps an active alarm above normal navigation. Do
    // not let a global interactive/debug/settings shortcut create a native
    // mode that React will intentionally refuse; Ctrl+Shift+Space remains the
    // separate emergency visibility path.
    if matches!(
        app.state::<DisplayWindowState>().snapshot()?.mode,
        DisplayWindowMode::Alarm
    ) {
        return Err(WindowingError::State {
            message: "An active alarm owns the overlay until it is dismissed or snoozed."
                .to_owned(),
        });
    }

    // Apply interaction before showing the window so the first click is not
    // swallowed by the previous ambient click-through policy.
    app.state::<DisplayWindowState>().set_mode(app, mode)?;
    let window = main_window(app)?;
    window
        .show()
        .map_err(|_| native_error("The app window could not be shown."))?;
    app.state::<DisplayWindowState>()
        .note_shortcut_visibility(true)
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, WindowingError> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| WindowingError::Unavailable {
            message: "The Ambient Glass overlay window is unavailable.".to_owned(),
        })
}

fn available_monitors(
    window: &WebviewWindow,
) -> Result<Vec<tauri::window::Monitor>, WindowingError> {
    window
        .available_monitors()
        .map_err(|_| native_error("The available displays could not be read."))
}

/// Restores the prior window geometry after a partial monitor move. Every
/// operation is deliberately best-effort: this helper runs while reporting the
/// original, more useful failure to the settings surface and must never mask it
/// with a second platform error.
fn restore_window_after_monitor_failure(
    window: &WebviewWindow,
    position: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    fullscreen: bool,
    visible: bool,
) {
    let _ = window.set_fullscreen(false);
    let _ = window.set_position(position);
    let _ = window.set_size(size);
    let _ = window.set_fullscreen(fullscreen);
    let _ = if visible {
        window.show()
    } else {
        window.hide()
    };
}

fn apply_mode(window: &WebviewWindow, mode: DisplayWindowMode) -> Result<(), WindowingError> {
    window
        .set_always_on_top(false)
        .map_err(|_| native_error("The app window could not leave always-on-top mode."))?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|_| native_error("The app window could not receive pointer input."))?;
    let _ = mode;
    Ok(())
}

fn as_result(snapshot: WindowStateSnapshot) -> WindowCommandResult {
    WindowCommandResult {
        mode: snapshot.mode,
        ready: snapshot.ready,
        visible: snapshot.visible,
        click_through: snapshot.mode.click_through(),
    }
}

fn native_error(message: &str) -> WindowingError {
    WindowingError::Native {
        message: message.to_owned(),
    }
}
