//! A constrained adapter for Wallpaper Engine's documented in-window playback.
//!
//! This is deliberately *not* a generic process runner. The only native
//! process this module may start is a validated `wallpaper64.exe`, using the
//! fixed argument sequence documented by Wallpaper Engine. On non-Windows
//! hosts it is a transparent mock so browser and macOS/Linux development never
//! changes the user's desktop.

use std::{collections::BTreeMap, fmt, path::PathBuf, sync::Mutex};

#[cfg(target_os = "windows")]
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
#[cfg(target_os = "windows")]
use tauri::Manager;

/// The complete set of scene keys. Deserializing this enum rejects unknown
/// scene names before a command reaches the adapter.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub enum SceneKey {
    #[serde(rename = "clear.dawn")]
    ClearDawn,
    #[serde(rename = "clear.day")]
    ClearDay,
    #[serde(rename = "clear.sunset")]
    ClearSunset,
    #[serde(rename = "clear.night")]
    ClearNight,
    #[serde(rename = "cloudy.day")]
    CloudyDay,
    #[serde(rename = "cloudy.night")]
    CloudyNight,
    #[serde(rename = "rain.day")]
    RainDay,
    #[serde(rename = "rain.night")]
    RainNight,
    #[serde(rename = "storm.any")]
    StormAny,
    #[serde(rename = "fog.any")]
    FogAny,
    #[serde(rename = "snow.any")]
    SnowAny,
    #[serde(rename = "fallback.any")]
    FallbackAny,
}

impl SceneKey {
    #[cfg(test)]
    pub const ALL: [Self; 12] = [
        Self::ClearDawn,
        Self::ClearDay,
        Self::ClearSunset,
        Self::ClearNight,
        Self::CloudyDay,
        Self::CloudyNight,
        Self::RainDay,
        Self::RainNight,
        Self::StormAny,
        Self::FogAny,
        Self::SnowAny,
        Self::FallbackAny,
    ];

    #[cfg(test)]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ClearDawn => "clear.dawn",
            Self::ClearDay => "clear.day",
            Self::ClearSunset => "clear.sunset",
            Self::ClearNight => "clear.night",
            Self::CloudyDay => "cloudy.day",
            Self::CloudyNight => "cloudy.night",
            Self::RainDay => "rain.day",
            Self::RainNight => "rain.night",
            Self::StormAny => "storm.any",
            Self::FogAny => "fog.any",
            Self::SnowAny => "snow.any",
            Self::FallbackAny => "fallback.any",
        }
    }
}

/// Structured errors are safe to return to the settings UI. They intentionally
/// omit raw OS error text, full paths, and process output.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommandError {
    Validation {
        field: &'static str,
        message: String,
    },
    #[cfg(target_os = "windows")]
    Unavailable {
        message: String,
    },
    #[cfg(target_os = "windows")]
    Launch {
        message: String,
    },
    State {
        message: String,
    },
}

impl fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation { message, .. } | Self::State { message } => {
                formatter.write_str(message)
            }
            #[cfg(target_os = "windows")]
            Self::Unavailable { message } | Self::Launch { message } => {
                formatter.write_str(message)
            }
        }
    }
}

impl std::error::Error for CommandError {}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WallpaperAdapterKind {
    #[cfg(target_os = "windows")]
    Native,
    Mock,
}

/// A redacted health response for the settings surface. `available` describes
/// whether real Wallpaper Engine control is available; a mock remains usable
/// for deterministic development but is explicit about not being native.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineStatus {
    pub adapter: WallpaperAdapterKind,
    pub available: bool,
    pub has_configured_path: bool,
    pub background_count: usize,
    pub in_app_active: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperOperationResult {
    pub scene: SceneKey,
    /// True only when a native or mock adapter accepted an in-app operation.
    /// A duplicate automatic request returns `false` without launching a child.
    pub applied: bool,
    /// The requested scene was already recorded as active by this controller.
    /// This is a successful terminal result for the frontend retry policy.
    pub duplicate: bool,
    pub mocked: bool,
    pub in_app: bool,
    pub message: String,
}

/// This input is non-secret and is intended to be persisted by Tauri Store in
/// the frontend. All fields are validated again in Rust because webview input
/// is never a security boundary.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperSettingsInput {
    /// A custom Steam-layout installation of Wallpaper Engine. `None` restores
    /// automatic discovery; it cannot point at an arbitrary program.
    #[serde(default)]
    pub executable_path: Option<String>,
    #[serde(default)]
    pub wallpaper_file: Option<String>,
    /// Optional weather/time overrides. Unknown scene keys fail enum
    /// deserialization before this command is entered.
    #[serde(default)]
    pub wallpaper_files: BTreeMap<SceneKey, String>,
}

#[derive(Clone, Default)]
struct WallpaperConfiguration {
    executable_path: Option<PathBuf>,
    wallpaper_file: Option<PathBuf>,
    wallpaper_files: BTreeMap<SceneKey, PathBuf>,
}

impl WallpaperConfiguration {
    fn apply_input(&mut self, input: WallpaperSettingsInput) -> Result<(), CommandError> {
        let executable_path = input
            .executable_path
            .as_deref()
            .map(validate_executable_path)
            .transpose()?;
        let wallpaper_file = input
            .wallpaper_file
            .as_deref()
            .map(validate_wallpaper_path)
            .transpose()?;
        let mut wallpaper_files = BTreeMap::new();
        for (scene, file) in input.wallpaper_files {
            wallpaper_files.insert(scene, validate_wallpaper_path(&file)?);
        }

        self.executable_path = executable_path;
        self.wallpaper_file = wallpaper_file;
        self.wallpaper_files = wallpaper_files;
        Ok(())
    }

    fn wallpaper_for(&self, scene: SceneKey) -> Result<PathBuf, CommandError> {
        let wallpaper = self
            .wallpaper_files
            .get(&scene)
            .or_else(|| self.wallpaper_files.get(&SceneKey::FallbackAny))
            .or(self.wallpaper_file.as_ref())
            .ok_or_else(|| CommandError::State {
                message: "Choose an in-app Wallpaper Engine file in settings.".to_owned(),
            })?;
        Ok(wallpaper.clone())
    }
}

struct ControllerState {
    configuration: WallpaperConfiguration,
    last_scene: Option<SceneKey>,
    #[cfg(target_os = "windows")]
    background_window: Option<isize>,
}

/// Shared native state. The mutex only protects a small settings snapshot and
/// is released before any process launch, so the UI thread is never held while
/// Wallpaper Engine starts.
pub struct WallpaperEngineController {
    state: Mutex<ControllerState>,
}

impl Default for WallpaperEngineController {
    fn default() -> Self {
        Self {
            state: Mutex::new(ControllerState {
                configuration: WallpaperConfiguration::default(),
                last_scene: None,
                #[cfg(target_os = "windows")]
                background_window: None,
            }),
        }
    }
}

impl WallpaperEngineController {
    pub fn status(&self) -> Result<WallpaperEngineStatus, CommandError> {
        let state = self.lock()?;
        #[cfg(target_os = "windows")]
        let in_app_active = state
            .background_window
            .is_some_and(background_window_is_valid);
        #[cfg(not(target_os = "windows"))]
        let in_app_active = false;
        Ok(platform_status(&state.configuration, in_app_active))
    }

    pub fn configure(
        &self,
        input: WallpaperSettingsInput,
    ) -> Result<WallpaperEngineStatus, CommandError> {
        let mut state = self.lock()?;
        state.configuration.apply_input(input)?;
        // A changed map must be allowed to apply immediately, even if its scene
        // key matches the last automatic selection.
        state.last_scene = None;
        #[cfg(target_os = "windows")]
        let in_app_active = state
            .background_window
            .is_some_and(background_window_is_valid);
        #[cfg(not(target_os = "windows"))]
        let in_app_active = false;
        Ok(platform_status(&state.configuration, in_app_active))
    }

    pub fn apply_scene(
        &self,
        app: &AppHandle,
        scene: SceneKey,
        force: bool,
    ) -> Result<WallpaperOperationResult, CommandError> {
        let (configuration, wallpaper, duplicate) = {
            let mut state = self.lock()?;
            let wallpaper = state.configuration.wallpaper_for(scene)?;
            #[cfg(target_os = "windows")]
            let in_app_active = state
                .background_window
                .is_some_and(background_window_is_valid);
            #[cfg(not(target_os = "windows"))]
            let in_app_active = true;

            // Wallpaper Engine can close its playback window independently.
            // A stale scene claim must never suppress the relaunch that repairs
            // that condition.
            if !in_app_active {
                state.last_scene = None;
                #[cfg(target_os = "windows")]
                {
                    state.background_window = None;
                }
            }
            let duplicate = !force && in_app_active && state.last_scene == Some(scene);

            if !duplicate {
                // Claim the scene before launching to suppress concurrent
                // duplicate requests. A failed launch clears this claim below.
                state.last_scene = Some(scene);
            }

            (state.configuration.clone(), wallpaper, duplicate)
        };

        if duplicate {
            return Ok(WallpaperOperationResult {
                scene,
                applied: false,
                duplicate: true,
                mocked: !cfg!(target_os = "windows"),
                in_app: cfg!(target_os = "windows"),
                message: "Scene already active; duplicate command suppressed.".to_owned(),
            });
        }

        match open_in_app_wallpaper(app, &configuration, &wallpaper) {
            Ok((mut result, _background_window)) => {
                result.scene = scene;
                #[cfg(target_os = "windows")]
                {
                    self.lock()?.background_window = _background_window;
                }
                Ok(result)
            }
            Err(error) => {
                let mut state = self.lock()?;
                if state.last_scene == Some(scene) {
                    state.last_scene = None;
                }
                Err(error)
            }
        }
    }

    pub fn close_in_app(&self) -> Result<(), CommandError> {
        let configuration = {
            let state = self.lock()?;
            state.configuration.clone()
        };
        close_in_app_wallpaper(&configuration)?;

        let mut state = self.lock()?;
        state.last_scene = None;
        #[cfg(target_os = "windows")]
        {
            state.background_window = None;
        }
        Ok(())
    }

    pub fn sync_with_app(&self, app: &AppHandle) {
        #[cfg(target_os = "windows")]
        {
            let background = self.lock().ok().and_then(|state| state.background_window);
            if let Some(background) = background {
                if !background_window_is_valid(background) {
                    if let Ok(mut state) = self.lock() {
                        if state.background_window == Some(background) {
                            state.background_window = None;
                            state.last_scene = None;
                        }
                    }
                } else if sync_background_window(app, background, false).is_err() {
                    // Geometry can be temporarily unavailable while a window
                    // is moving between displays. A later native window event
                    // retries the synchronization; avoid logging paths or raw
                    // operating-system errors here.
                    log::warn!("The in-app wallpaper window could not be synchronized.");
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        let _ = app;
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ControllerState>, CommandError> {
        self.state.lock().map_err(|_| CommandError::State {
            message: "Wallpaper control is temporarily unavailable.".to_owned(),
        })
    }
}

fn validate_wallpaper_path(value: &str) -> Result<PathBuf, CommandError> {
    let trimmed = value.trim();
    if value.is_empty() || value != trimmed {
        return Err(CommandError::Validation {
            field: "wallpaperFile",
            message: "Wallpaper file paths cannot be empty or start/end with whitespace."
                .to_owned(),
        });
    }
    if value.chars().count() > 1024 || value.chars().any(char::is_control) {
        return Err(CommandError::Validation {
            field: "wallpaperFile",
            message: "Wallpaper file path is invalid.".to_owned(),
        });
    }
    let lower = value.to_ascii_lowercase();
    let supported = lower.ends_with("project.json")
        || lower.ends_with(".pkg")
        || lower.ends_with(".mp4")
        || lower.ends_with(".webm")
        || lower.ends_with(".html");
    if !supported {
        return Err(CommandError::Validation {
            field: "wallpaperFile",
            message: "Use project.json, scene.pkg, MP4, WebM, or index.html.".to_owned(),
        });
    }
    Ok(PathBuf::from(value))
}

/// A custom executable must still use Steam's normal Wallpaper Engine install
/// layout. This prevents a compromised webview from turning the configuration
/// field into a general program launcher.
fn validate_executable_path(value: &str) -> Result<PathBuf, CommandError> {
    if value.is_empty() || value != value.trim() || value.chars().count() > 1024 {
        return Err(CommandError::Validation {
            field: "executablePath",
            message: "Wallpaper Engine path is invalid.".to_owned(),
        });
    }
    if value.chars().any(char::is_control) {
        return Err(CommandError::Validation {
            field: "executablePath",
            message: "Wallpaper Engine path contains unsupported characters.".to_owned(),
        });
    }

    let components: Vec<String> = value
        .split(['/', '\\'])
        .filter(|component| !component.is_empty())
        .map(|component| component.to_ascii_lowercase())
        .collect();
    let expected = ["steamapps", "common", "wallpaper_engine", "wallpaper64.exe"];

    if components
        .iter()
        .any(|component| component == "." || component == "..")
        || components.len() < expected.len()
        || !components[components.len() - expected.len()..]
            .iter()
            .map(String::as_str)
            .eq(expected)
    {
        return Err(CommandError::Validation {
            field: "executablePath",
            message: "Use wallpaper64.exe from Steam's wallpaper_engine folder.".to_owned(),
        });
    }

    Ok(PathBuf::from(value))
}

fn platform_status(
    configuration: &WallpaperConfiguration,
    in_app_active: bool,
) -> WallpaperEngineStatus {
    let background_count =
        usize::from(configuration.wallpaper_file.is_some()) + configuration.wallpaper_files.len();
    #[cfg(target_os = "windows")]
    {
        let available = resolve_windows_executable(configuration).is_some();
        WallpaperEngineStatus {
            adapter: WallpaperAdapterKind::Native,
            available,
            has_configured_path: configuration.executable_path.is_some(),
            background_count,
            in_app_active,
            message: if available {
                if in_app_active {
                    "Wallpaper Engine is rendering inside Ambient Glass.".to_owned()
                } else if background_count > 0 {
                    "In-app Wallpaper Engine playback is configured.".to_owned()
                } else {
                    "Wallpaper Engine is ready. Choose an in-app wallpaper file.".to_owned()
                }
            } else {
                "Wallpaper Engine was not found. Choose its Steam installation in settings."
                    .to_owned()
            },
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = in_app_active;
        WallpaperEngineStatus {
            adapter: WallpaperAdapterKind::Mock,
            available: false,
            has_configured_path: configuration.executable_path.is_some(),
            background_count,
            in_app_active: false,
            message: "In-app Wallpaper Engine playback is available on Windows only.".to_owned(),
        }
    }
}

#[cfg(target_os = "windows")]
const BACKGROUND_WINDOW_NAME: &str = "Ambient Glass Background";

#[cfg(target_os = "windows")]
fn open_in_app_wallpaper(
    app: &AppHandle,
    configuration: &WallpaperConfiguration,
    wallpaper: &Path,
) -> Result<(WallpaperOperationResult, Option<isize>), CommandError> {
    use std::{
        process::{Command, Stdio},
        thread,
        time::Duration,
    };
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW;

    let executable =
        resolve_windows_executable(configuration).ok_or_else(|| CommandError::Unavailable {
            message: "Wallpaper Engine was not found. Check its Steam installation in settings."
                .to_owned(),
        })?;

    let wallpaper = wallpaper
        .canonicalize()
        .map_err(|_| CommandError::Unavailable {
            message: "The configured wallpaper file could not be found.".to_owned(),
        })?;
    if !wallpaper.is_file() {
        return Err(CommandError::Unavailable {
            message: "The configured wallpaper file could not be found.".to_owned(),
        });
    }
    validate_wallpaper_path(&wallpaper.to_string_lossy())?;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| CommandError::State {
            message: "The Ambient Glass window is unavailable.".to_owned(),
        })?;
    let position = window.inner_position().map_err(|_| CommandError::State {
        message: "The app background position could not be read.".to_owned(),
    })?;
    let size = window.inner_size().map_err(|_| CommandError::State {
        message: "The app background size could not be read.".to_owned(),
    })?;

    Command::new(executable)
        .arg("-control")
        .arg("openWallpaper")
        .arg("-file")
        .arg(&wallpaper)
        .arg("-playInWindow")
        .arg(BACKGROUND_WINDOW_NAME)
        .arg("-width")
        .arg(size.width.to_string())
        .arg("-height")
        .arg(size.height.to_string())
        .arg("-x")
        .arg(position.x.to_string())
        .arg("-y")
        .arg(position.y.to_string())
        .arg("-borderless")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| CommandError::Launch {
            message: "Wallpaper Engine could not be started.".to_owned(),
        })?;

    let title = wide_null(BACKGROUND_WINDOW_NAME);
    let mut background = 0 as HWND;
    for _ in 0..40 {
        background = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
        if background != 0 as HWND {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    if background == 0 as HWND {
        return Err(CommandError::Launch {
            message: "Wallpaper Engine opened, but its in-app window did not become ready."
                .to_owned(),
        });
    }

    let background = background as isize;
    sync_background_window(app, background, true)?;
    Ok((
        WallpaperOperationResult {
            scene: SceneKey::FallbackAny,
            applied: true,
            duplicate: false,
            mocked: false,
            in_app: true,
            message: "Wallpaper Engine is now rendering behind the Ambient Glass interface."
                .to_owned(),
        },
        Some(background),
    ))
}

#[cfg(not(target_os = "windows"))]
fn open_in_app_wallpaper(
    _app: &AppHandle,
    _configuration: &WallpaperConfiguration,
    _wallpaper: &std::path::Path,
) -> Result<(WallpaperOperationResult, Option<isize>), CommandError> {
    Ok((
        WallpaperOperationResult {
            scene: SceneKey::FallbackAny,
            applied: true,
            duplicate: false,
            mocked: true,
            in_app: false,
            message: "In-app Wallpaper Engine playback is mocked outside Windows.".to_owned(),
        },
        None,
    ))
}

#[cfg(target_os = "windows")]
fn sync_background_window(
    app: &AppHandle,
    background: isize,
    refresh_window_style: bool,
) -> Result<(), CommandError> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, WS_EX_APPWINDOW,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    let background = background as windows_sys::Win32::Foundation::HWND;
    if !background_window_is_valid(background as isize) {
        return Err(CommandError::State {
            message: "The in-app Wallpaper Engine window is no longer available.".to_owned(),
        });
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| CommandError::State {
            message: "The Ambient Glass window is unavailable.".to_owned(),
        })?;
    if refresh_window_style {
        unsafe {
            let style = GetWindowLongPtrW(background, GWL_EXSTYLE);
            let style = (style & !(WS_EX_APPWINDOW as isize))
                | WS_EX_TOOLWINDOW as isize
                | WS_EX_NOACTIVATE as isize;
            SetWindowLongPtrW(background, GWL_EXSTYLE, style);
        }
    }
    let visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    if !visible {
        unsafe { ShowWindow(background, SW_HIDE) };
        return Ok(());
    }

    let position = window.inner_position().map_err(|_| CommandError::State {
        message: "The app background position could not be read.".to_owned(),
    })?;
    let size = window.inner_size().map_err(|_| CommandError::State {
        message: "The app background size could not be read.".to_owned(),
    })?;
    let main = window
        .hwnd()
        .map_err(|_| CommandError::State {
            message: "The app window handle is unavailable.".to_owned(),
        })?
        .0 as windows_sys::Win32::Foundation::HWND;
    let width = i32::try_from(size.width).map_err(|_| CommandError::State {
        message: "The app background size is unsupported.".to_owned(),
    })?;
    let height = i32::try_from(size.height).map_err(|_| CommandError::State {
        message: "The app background size is unsupported.".to_owned(),
    })?;

    unsafe {
        let flags = SWP_NOACTIVATE
            | SWP_SHOWWINDOW
            | if refresh_window_style {
                SWP_FRAMECHANGED
            } else {
                0
            };
        let positioned = SetWindowPos(
            background, main, position.x, position.y, width, height, flags,
        );
        if positioned == 0 {
            return Err(CommandError::State {
                message: "The in-app wallpaper could not follow the Ambient Glass window."
                    .to_owned(),
            });
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn background_window_is_valid(background: isize) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::IsWindow;

    unsafe { IsWindow(background as windows_sys::Win32::Foundation::HWND) != 0 }
}

#[cfg(target_os = "windows")]
fn close_in_app_wallpaper(configuration: &WallpaperConfiguration) -> Result<(), CommandError> {
    use std::process::{Command, Stdio};
    let Some(executable) = resolve_windows_executable(configuration) else {
        return Ok(());
    };
    Command::new(executable)
        .arg("-control")
        .arg("closeWallpaper")
        .arg("-location")
        .arg(BACKGROUND_WINDOW_NAME)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| CommandError::Launch {
            message: "The in-app Wallpaper Engine window could not be closed.".to_owned(),
        })?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn close_in_app_wallpaper(_configuration: &WallpaperConfiguration) -> Result<(), CommandError> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn resolve_windows_executable(configuration: &WallpaperConfiguration) -> Option<PathBuf> {
    let configured = configuration.executable_path.clone().into_iter();
    let program_files = std::env::var_os("PROGRAMFILES(X86)")
        .map(PathBuf::from)
        .or_else(|| Some(PathBuf::from(r"C:\Program Files (x86)")));
    let default_steam = program_files
        .into_iter()
        .map(|path| steam_wallpaper_path(&path));
    let registry_steam = steam_path_from_registry()
        .into_iter()
        .map(|path| steam_wallpaper_path(&path));

    configured
        .chain(default_steam)
        .chain(registry_steam)
        .find_map(existing_valid_executable)
}

#[cfg(target_os = "windows")]
fn steam_wallpaper_path(steam_root: &Path) -> PathBuf {
    steam_root
        .join("steamapps")
        .join("common")
        .join("wallpaper_engine")
        .join("wallpaper64.exe")
}

#[cfg(target_os = "windows")]
fn existing_valid_executable(candidate: PathBuf) -> Option<PathBuf> {
    let canonical = candidate.canonicalize().ok()?;
    if !canonical.is_file() {
        return None;
    }
    validate_executable_path(&canonical.to_string_lossy()).ok()?;
    Some(canonical)
}

/// Read Steam's own registry value directly. We never invoke `reg.exe`, so this
/// discovery path does not widen the process-launch surface.
#[cfg(target_os = "windows")]
fn steam_path_from_registry() -> Option<PathBuf> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
        RegKey,
    };

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    read_steam_path(&current_user, r"Software\Valve\Steam").or_else(|| {
        let local_machine = RegKey::predef(HKEY_LOCAL_MACHINE);
        read_steam_path(&local_machine, r"SOFTWARE\WOW6432Node\Valve\Steam")
            .or_else(|| read_steam_path(&local_machine, r"SOFTWARE\Valve\Steam"))
    })
}

#[cfg(target_os = "windows")]
fn read_steam_path(root: &winreg::RegKey, key: &str) -> Option<PathBuf> {
    root.open_subkey(key)
        .ok()?
        .get_value::<String, _>("SteamPath")
        .ok()
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::{validate_executable_path, validate_wallpaper_path, SceneKey};

    #[test]
    fn plan_scene_keys_are_complete_and_unique() {
        assert_eq!(SceneKey::ALL.len(), 12);
        assert_eq!(SceneKey::ALL[0].as_str(), "clear.dawn");
        assert_eq!(SceneKey::ALL[11].as_str(), "fallback.any");
    }

    #[test]
    fn wallpaper_validation_accepts_only_supported_background_files() {
        assert!(validate_wallpaper_path(
            r"C:\\Steam\\steamapps\\workshop\\content\\431960\\123\\project.json"
        )
        .is_ok());
        assert!(validate_wallpaper_path(r"D:\\Wallpapers\\rain.mp4").is_ok());
        assert!(validate_wallpaper_path(r"D:\\Wallpapers\\unsafe.exe").is_err());
        assert!(validate_wallpaper_path(r" D:\\Wallpapers\\rain.mp4").is_err());
    }

    #[test]
    fn executable_validation_allows_only_the_wallpaper_engine_layout() {
        assert!(validate_executable_path(
            r"C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe"
        )
        .is_ok());
        assert!(validate_executable_path(r"C:\\tools\\other-program.exe").is_err());
    }
}
