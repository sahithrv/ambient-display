//! A constrained adapter for Wallpaper Engine's `openPlaylist` CLI control.
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
    pub monitor_index: u8,
    pub playlist_count: usize,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperOperationResult {
    pub scene: SceneKey,
    pub playlist: String,
    /// True only when a native or mock adapter accepted a playlist operation.
    /// A duplicate automatic request returns `false` without launching a child.
    pub applied: bool,
    /// The requested scene was already recorded as active by this controller.
    /// This is a successful terminal result for the frontend retry policy.
    pub duplicate: bool,
    pub mocked: bool,
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
    /// Wallpaper Engine monitor number. This is passed only to Wallpaper
    /// Engine's `-monitor` argument; it does not select the Tauri overlay
    /// window's display. A bounded range avoids malformed command input while
    /// supporting common multi-display arrangements.
    #[serde(default)]
    pub monitor_index: u8,
    /// Partial overrides are merged with the safe default scene map. Unknown
    /// scene keys fail enum deserialization before this command is entered.
    #[serde(default)]
    pub playlists: BTreeMap<SceneKey, String>,
}

#[derive(Clone)]
struct WallpaperConfiguration {
    executable_path: Option<PathBuf>,
    monitor_index: u8,
    playlists: BTreeMap<SceneKey, String>,
}

impl Default for WallpaperConfiguration {
    fn default() -> Self {
        let playlists = BTreeMap::from([
            (SceneKey::ClearDawn, "AG Clear Dawn".to_owned()),
            (SceneKey::ClearDay, "AG Clear Day".to_owned()),
            (SceneKey::ClearSunset, "AG Clear Sunset".to_owned()),
            (SceneKey::ClearNight, "AG Clear Night".to_owned()),
            (SceneKey::CloudyDay, "AG Cloudy Day".to_owned()),
            (SceneKey::CloudyNight, "AG Cloudy Night".to_owned()),
            (SceneKey::RainDay, "AG Rain Day".to_owned()),
            (SceneKey::RainNight, "AG Rain Night".to_owned()),
            (SceneKey::StormAny, "AG Storm".to_owned()),
            (SceneKey::FogAny, "AG Fog".to_owned()),
            (SceneKey::SnowAny, "AG Snow".to_owned()),
            (SceneKey::FallbackAny, "AG Fallback".to_owned()),
        ]);

        Self {
            executable_path: None,
            monitor_index: 0,
            playlists,
        }
    }
}

impl WallpaperConfiguration {
    fn apply_input(&mut self, input: WallpaperSettingsInput) -> Result<(), CommandError> {
        if input.monitor_index > 15 {
            return Err(CommandError::Validation {
                field: "monitorIndex",
                message: "Choose a monitor index from 0 through 15.".to_owned(),
            });
        }

        let executable_path = input
            .executable_path
            .as_deref()
            .map(validate_executable_path)
            .transpose()?;

        for playlist in input.playlists.values() {
            validate_playlist_name(playlist)?;
        }

        self.executable_path = executable_path;
        self.monitor_index = input.monitor_index;
        self.playlists.extend(input.playlists);
        Ok(())
    }

    fn playlist_for(&self, scene: SceneKey) -> Result<String, CommandError> {
        let playlist = self
            .playlists
            .get(&scene)
            .ok_or_else(|| CommandError::State {
                message: "The requested scene is not configured.".to_owned(),
            })?;

        // Validate once more at the trust boundary in case a future storage
        // migration or internal caller changes the configuration representation.
        validate_playlist_name(playlist)?;
        Ok(playlist.clone())
    }
}

struct ControllerState {
    configuration: WallpaperConfiguration,
    last_scene: Option<SceneKey>,
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
            }),
        }
    }
}

impl WallpaperEngineController {
    pub fn status(&self) -> Result<WallpaperEngineStatus, CommandError> {
        let state = self.lock()?;
        Ok(platform_status(&state.configuration))
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
        Ok(platform_status(&state.configuration))
    }

    pub fn apply_scene(
        &self,
        scene: SceneKey,
        force: bool,
    ) -> Result<WallpaperOperationResult, CommandError> {
        let (configuration, playlist, duplicate) = {
            let mut state = self.lock()?;
            let playlist = state.configuration.playlist_for(scene)?;
            let duplicate = !force && state.last_scene == Some(scene);

            if !duplicate {
                // Claim the scene before launching to suppress concurrent
                // duplicate requests. A failed launch clears this claim below.
                state.last_scene = Some(scene);
            }

            (state.configuration.clone(), playlist, duplicate)
        };

        if duplicate {
            return Ok(WallpaperOperationResult {
                scene,
                playlist,
                applied: false,
                duplicate: true,
                mocked: !cfg!(target_os = "windows"),
                message: "Scene already active; duplicate command suppressed.".to_owned(),
            });
        }

        match open_playlist(&configuration, &playlist) {
            Ok(mut result) => {
                result.scene = scene;
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

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ControllerState>, CommandError> {
        self.state.lock().map_err(|_| CommandError::State {
            message: "Wallpaper control is temporarily unavailable.".to_owned(),
        })
    }
}

/// Playlist labels are not interpreted by a shell, but keeping them short and
/// path-free prevents accidental configuration mistakes and makes the settings
/// file safe to display or audit.
fn validate_playlist_name(value: &str) -> Result<(), CommandError> {
    let trimmed = value.trim();
    if value.is_empty() || value != trimmed {
        return Err(CommandError::Validation {
            field: "playlists",
            message: "Playlist names cannot be empty or start/end with whitespace.".to_owned(),
        });
    }
    if value.chars().count() > 96 {
        return Err(CommandError::Validation {
            field: "playlists",
            message: "Playlist names must be 96 characters or fewer.".to_owned(),
        });
    }
    if value.chars().any(|character| {
        character.is_control() || matches!(character, '/' | '\\' | '"' | '\'' | '`')
    }) {
        return Err(CommandError::Validation {
            field: "playlists",
            message: "Playlist names contain unsupported characters.".to_owned(),
        });
    }
    Ok(())
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

fn platform_status(configuration: &WallpaperConfiguration) -> WallpaperEngineStatus {
    #[cfg(target_os = "windows")]
    {
        let available = resolve_windows_executable(configuration).is_some();
        WallpaperEngineStatus {
            adapter: WallpaperAdapterKind::Native,
            available,
            has_configured_path: configuration.executable_path.is_some(),
            monitor_index: configuration.monitor_index,
            playlist_count: configuration.playlists.len(),
            message: if available {
                "Wallpaper Engine control is ready.".to_owned()
            } else {
                "Wallpaper Engine was not found. Choose its Steam installation in settings."
                    .to_owned()
            },
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        WallpaperEngineStatus {
            adapter: WallpaperAdapterKind::Mock,
            available: false,
            has_configured_path: configuration.executable_path.is_some(),
            monitor_index: configuration.monitor_index,
            playlist_count: configuration.playlists.len(),
            message: "Wallpaper Engine control is mocked outside Windows.".to_owned(),
        }
    }
}

#[cfg(target_os = "windows")]
fn open_playlist(
    configuration: &WallpaperConfiguration,
    playlist: &str,
) -> Result<WallpaperOperationResult, CommandError> {
    use std::process::{Command, Stdio};

    let executable =
        resolve_windows_executable(configuration).ok_or_else(|| CommandError::Unavailable {
            message: "Wallpaper Engine was not found. Check its Steam installation in settings."
                .to_owned(),
        })?;

    // This is intentionally the only process launch in this crate. `Command`
    // receives a validated executable and separate, fixed argument positions;
    // no command interpreter, command string, or user-controlled flag exists.
    Command::new(executable)
        .arg("-control")
        .arg("openPlaylist")
        .arg("-playlist")
        .arg(playlist)
        .arg("-monitor")
        .arg(configuration.monitor_index.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| CommandError::Launch {
            message: "Wallpaper Engine could not be started.".to_owned(),
        })?;

    Ok(WallpaperOperationResult {
        scene: SceneKey::FallbackAny,
        playlist: playlist.to_owned(),
        applied: true,
        duplicate: false,
        mocked: false,
        message: "Playlist command sent to Wallpaper Engine.".to_owned(),
    })
}

#[cfg(not(target_os = "windows"))]
fn open_playlist(
    _configuration: &WallpaperConfiguration,
    playlist: &str,
) -> Result<WallpaperOperationResult, CommandError> {
    // This mock intentionally performs no desktop operation and has no hidden
    // fallback to a shell command. It makes previews and visual tests stable.
    Ok(WallpaperOperationResult {
        scene: SceneKey::FallbackAny,
        playlist: playlist.to_owned(),
        applied: true,
        duplicate: false,
        mocked: true,
        message: "Mock playlist change recorded; Wallpaper Engine runs only on Windows.".to_owned(),
    })
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
    use super::{validate_executable_path, validate_playlist_name, SceneKey};

    #[test]
    fn plan_scene_keys_are_complete_and_unique() {
        assert_eq!(SceneKey::ALL.len(), 12);
        assert_eq!(SceneKey::ALL[0].as_str(), "clear.dawn");
        assert_eq!(SceneKey::ALL[11].as_str(), "fallback.any");
    }

    #[test]
    fn playlist_validation_rejects_path_like_input() {
        assert!(validate_playlist_name("AG Rain Night").is_ok());
        assert!(validate_playlist_name("AG Rain/Night").is_err());
        assert!(validate_playlist_name(" AG Rain Night").is_err());
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
