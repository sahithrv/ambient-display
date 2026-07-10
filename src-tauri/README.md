# Ambient Glass native layer

This directory contains the Tauri 2 desktop shell. It intentionally exposes a
small IPC surface rather than a generic operating-system bridge.

## Safety model

- There is no Tauri Shell, Process, or Filesystem capability. The only opener
  permission is restricted to `https://accounts.google.com/**` and is used by
  the native Google Calendar OAuth flow to launch the system browser.
- Wallpaper Engine calls use `std::process::Command` with fixed argument
  positions; no command string is assembled and no shell is invoked.
- The frontend requests an allowlisted `SceneKey`, never an executable, CLI
  flags, or raw playlist at the moment a scene is applied.
- Configuration accepts only the known scene keys, safe playlist labels, a
  bounded monitor index, and a `wallpaper64.exe` path in the normal Steam
  `steamapps/common/wallpaper_engine` layout.
- On macOS and Linux, the adapter replies with explicit deterministic mock
  results and does not spawn a process.

## Frontend handoff

Use Tauri's typed `invoke` imports (not `window.__TAURI__`, which is disabled)
with these commands:

```text
mark_overlay_ready()
set_display_window_mode({ mode })
get_display_window_state()
get_display_monitors()
set_display_monitor({ monitorIndex })
get_wallpaper_engine_status()
configure_wallpaper_engine({ settings })
apply_wallpaper_scene({ scene })
test_wallpaper_scene({ scene })
get_github_commits({ localDay? })
refresh_sports()
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

The frontend `WallpaperSetup` surface persists the complete non-secret
snapshot (`executablePath`, `monitorIndex`, every allowlisted scene playlist,
manual scene lock, fallback preference, and `overlayMonitorIndex`) before
invoking this command. Its `monitorIndex` is passed only to Wallpaper Engine's
`-monitor` argument. `set_display_monitor` separately validates a current
platform monitor index, moves the overlay there, and restores fullscreen. Each
per-scene **Test**
action first applies the validated snapshot and then invokes
`test_wallpaper_scene`, which deliberately bypasses duplicate suppression.
When Wallpaper Engine reports unavailable, the frontend receives a render-safe
fallback signal without exposing executable paths or native error details.

The GitHub, sports, and transcription commands are backend-only boundaries.
They accept no API key or OAuth token as invocation arguments: fixed-slot
credentials are saved through the OS keychain and read only by Rust. GitHub
uses the authenticated viewer's `totalCommitContributions` for a requested
local day; sports events are normalized before leaving Rust; OpenAI audio is
accepted only for bounded explicit push-to-talk and then discarded. Their
non-secret normalized output may be cached by the frontend for an honest stale
offline view. `get_secure_token_storage_status` returns booleans only and
never returns secret material.

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
state. Interactive/debug and settings shortcuts restore pointer input before
showing the window, so the first click works. A shortcut also completes the
native startup-ready handshake, preventing a late `mark_overlay_ready` call
from re-showing an overlay the user just hid.

On Windows, a native monitor can emit `ambient-glass://input-activity` while
the ready, visible overlay is click-through and in `ambient` or `sleep` mode.
It observes only that the session's last-input tick changed and sends the fixed
payload `{ source: "windowsSession" }`; it never forwards raw keyboard, mouse,
pointer, button, device, tick, timestamp, or process data. The monitor is not a
background service and does not claim wake-from-sleep capability. It is a
privacy-preserving fallback for a click-through, app-active display; global
shortcuts remain the recovery path on every platform.

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

The configuration targets a transparent, fullscreen, borderless, skipped-
taskbar overlay. Those behaviors, click-through, the global shortcuts, and
`wallpaper64.exe` control must be smoke-tested on the Dell XPS running Windows
and Wallpaper Engine. Non-Windows mock responses are intentionally not proof
of native behavior.
