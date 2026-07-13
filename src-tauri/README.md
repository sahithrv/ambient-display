# Ambient Glass native layer

This directory contains the Tauri 2 desktop shell. It intentionally exposes a
small IPC surface rather than a generic operating-system bridge.

## Safety model

- There is no generic Tauri Shell, Process, or Filesystem capability. Frontend
  opener permission is restricted to `https://accounts.google.com/**` for
  Google Calendar OAuth; the custom wallpaper-folder command can open only the
  fixed Ambient Glass app-local library directory.
- Wallpaper Engine calls use `std::process::Command` with fixed argument
  positions; no command string is assembled and no shell is invoked.
- The frontend requests an allowlisted `SceneKey`, never an executable, CLI
  flags, or raw wallpaper path at the moment a scene is applied.
- Configuration accepts only the known scene keys, validated wallpaper files,
  and a `wallpaper64.exe` path in the normal Steam
  `steamapps/common/wallpaper_engine` layout. Supported background inputs are
  a Wallpaper Engine `project.json` or packaged scene, a supported video, or a
  web-wallpaper HTML entry file.
- The adapter uses Wallpaper Engine's fixed `openWallpaper` + `playInWindow`
  flow. It never issues `openPlaylist` or a desktop/monitor-targeting command.
  Wallpaper Engine playlists cannot be passed to `playInWindow`, so playlist
  labels are not valid configuration values.
- On macOS and Linux, the adapter replies with explicit deterministic mock
  results and does not spawn a process.
- App-owned wallpaper import is a separate, bounded command path. The Rust
  command opens the native multi-file dialog, so source paths never enter
  renderer memory. The command validates both extension and media structure,
  copies accepted files into content-addressed app-local storage, and never
  persists or returns the original source path. The asset
  protocol is scoped only to the managed JPG, PNG, WebP, MP4, and WebM files.

## Frontend handoff

Use Tauri's typed `invoke` imports (not `window.__TAURI__`, which is disabled)
with these commands:

```text
mark_overlay_ready()
set_display_window_mode({ mode })
get_display_window_state()
get_display_monitors()
set_display_monitor({ monitorIndex })
quit_application()
get_wallpaper_engine_status()
configure_wallpaper_engine({ settings })
apply_wallpaper_scene({ scene })
test_wallpaper_scene({ scene })
close_in_app_wallpaper()
list_wallpaper_library()
pick_and_import_wallpapers()
delete_wallpaper_asset({ id })
reveal_wallpaper_library()
get_github_commits({ localDay? })
refresh_sports({ localDay?, favoriteTeamIds? })
transcribe_audio({ mimeType, durationMs, explicitPushToTalk, audio })
save_provider_secret({ slot, value })
delete_provider_secret({ slot })
get_secure_token_storage_status()
begin_google_calendar_oauth()
complete_google_calendar_oauth()
disconnect_google_calendar()
get_google_calendar_today({ localDay? })
create_google_calendar_event({ event: { title, startsAt, endsAt?, allDay } })
list_native_alarms()
get_native_alarm_scheduler_status()
schedule_native_alarm({ alarm })
snooze_native_alarm({ id, minutes? })
dismiss_native_alarm({ id })
test_native_alarm({ id })
```

`scene` uses the plan's exact keys, such as `clear.day` and `rain.night`.
`configure_wallpaper_engine` changes the native in-memory snapshot only. Store
non-secret settings in the frontend's Tauri Store and resend the validated
snapshot after startup.

The frontend wallpaper settings persist one complete non-secret snapshot:
explicit source mode, local-library single/shuffle preferences, Wallpaper
Engine executable/default/scene files, manual scene lock, fallback preference,
and `overlayMonitorIndex`. `set_display_monitor`
separately validates a current platform monitor index and centers the regular
app window there; that app-window choice is never passed to Wallpaper Engine
as a desktop wallpaper monitor. Each per-scene **Test**
action first applies the validated snapshot and then invokes
`test_wallpaper_scene`, which deliberately bypasses duplicate suppression.
The native adapter opens the selected file in the named
`Ambient Glass Background` render surface, sizes and positions that surface to
the app's client area, keeps it visually behind the Tauri window, and
synchronizes it when the app moves, resizes, hides, or returns.
`close_in_app_wallpaper` closes that named surface. It does not change the
user's Windows desktop wallpaper.
When Wallpaper Engine reports unavailable, the frontend receives a render-safe
fallback signal without exposing executable paths or native error details.
The browser preview uses bundled deterministic library media above the internal
fallback and works without user-file access, provider credentials, or
Windows-only APIs.

## App-owned wallpaper library boundary

`list_wallpaper_library`, `pick_and_import_wallpapers`, and
`delete_wallpaper_asset` serialize access to `$APPLOCALDATA/wallpapers`.
The native picker accepts at most 100 files per operation. Import caps the
managed library at 250 files and 64 GiB, caps each file at 8 GiB, validates
media structure as well as extension, content-addresses accepted copies, and
deduplicates identical media. Snapshots expose only validated metadata plus the
managed destination path required to create an asset URL; the frontend must not
persist, display, or log that destination. `reveal_wallpaper_library` opens
only the fixed managed directory and accepts no path argument.

Single/shuffle choice, enabled asset IDs, active selection, interval, and
source mode are non-secret frontend settings. The renderer cycles a no-repeat
shuffle bag and can switch explicitly among the app-owned library, Wallpaper
Engine, and the internal fallback; none of those preferences expands native
filesystem access.

The GitHub, sports, and transcription commands are backend-only boundaries.
They accept no API key or OAuth token as invocation arguments: fixed-slot
credentials are saved through the OS keychain and read only by Rust. GitHub
uses the authenticated viewer's `totalCommitContributions` for a requested
local day; sports events are normalized before leaving Rust; OpenAI audio is
accepted only for bounded explicit push-to-talk and then discarded. Their
non-secret normalized output may be cached by the frontend for an honest stale
offline view. `get_secure_token_storage_status` returns booleans only and
never returns secret material.

`refresh_sports` optionally accepts up to eight unique numeric TheSportsDB
team IDs. The native provider combines the bounded daily feed with previous
and next schedule calls for those teams, normalizes and deduplicates the result,
and keys its cache by day plus selected IDs. Ordered favorite names, name-only
matching, and the **Show only favorites** filter remain non-secret frontend
preferences; no API key enters those settings or the invocation arguments.

## Google Calendar boundary

Google Calendar uses the OAuth 2.0 installed-app flow with a loopback callback
and PKCE. `begin_google_calendar_oauth` opens the system browser and returns
only a status. The frontend polls `complete_google_calendar_oauth` after the
user grants or declines consent. The authorization URL, state, verifier,
callback code, access token, and refresh token never cross the Tauri command
boundary.

The native build must set the public desktop OAuth client ID through
`AMBIENT_GOOGLE_CLIENT_ID`; create a **Desktop app** OAuth client in Google
Cloud, configure its OAuth consent screen, and enable the Google Calendar API.
For an external app, add test users while testing; publish and complete any
Google verification required for Calendar data scopes before distributing it
beyond those users. This is a build-time value, not a `VITE_*` setting. If it
is absent or malformed, Calendar commands return an explicit setup error and
local reminders continue to work.

Only the refresh token is saved, in the existing OS credential-store slot.
Access tokens are refreshed in memory for each request. Calendar reads return
`{ events, stale, message }`, are bounded to one local day, normalized to the
display-safe event shape, and held only in a short-lived native memory cache.
Event creation always targets the
authenticated user's primary calendar and accepts only a title, bounded start
and end, and all-day flag; it cannot select another calendar or attach raw
Google event data. Disconnect deletes the refresh token and clears the native
Calendar cache and pending authorization attempt.

The Rust shortcut handler emits `ambient-glass://shortcut` only after a native
window operation succeeds. Its payload is `{ action, visible }`, where
`action` is `toggle`, `interactive`, `debug`, or `settings`; the `visible`
boolean is the resulting native visibility. This lets the frontend map a
toggle from the actual hide/show result instead of guessing based on stale web
state. A shortcut also completes the native startup-ready handshake, preventing
a late `mark_overlay_ready` call from re-showing a window the user just hid.

Ambient Glass is a regular desktop window and does not run a native
session-input poller. Its webview receives its own keyboard and pointer input
directly, while global shortcuts remain optional conveniences on every
platform.

## Native alarm boundary

`schedule_native_alarm` stores only non-secret alarm fields (`id`, `label`,
`localTime`, `daysOfWeek`, `enabled`, `soundId`, and `snoozeMinutes`) in the
app-local data directory. `list_native_alarms` returns `{ alarms, active,
status }`; mutations return `{ alarm, active, status, message }`. A due,
snoozed, dismissed, or test action emits `ambient-glass://alarm` with
`{ kind, active, notification, audio, message }`.

The scheduler polls only while the Ambient Glass process is alive. It does not
register a background service, wake a sleeping computer, or claim to provide a
wake-from-sleep alarm. A delayed in-process poll may recover scheduled alarms
and snoozes that are at most 15 minutes old only after a prior scan in the
same process; the window does not span app restart and older due occurrences
are discarded rather than replayed.
Simultaneous due alarms are retained in a deterministic, process-local queue
until the active alarm is snoozed or dismissed. If app-local storage cannot be
prepared, the scheduler remains usable in memory for the current process and
reports `status.persistentStorageReady: false` with an explicit restart-loss
warning. Notifications are sent only after OS permission was previously
granted. `status.audio.ready` is deliberately `false` because the scheduler has
no independent native audio service; the active frontend plays its bundled
local chime and retains a WebAudio fallback.

## Windows validation still required

The configuration targets a resizable taskbar window with normal title-bar
controls. **Windows/Dell runtime validation remains unverified.** App-owned
image/video import, asset-protocol playback, persistence, WebView2 codecs,
shuffle/source switching, and the 960×700 settings workspace must be tested on
the Dell XPS. Native global shortcuts and the optional Wallpaper Engine in-app
surface also require move/resize/minimize/restore, focus, close, and confirmation
that the desktop wallpaper is unchanged.
Non-Windows mock responses are intentionally not proof of native behavior.
