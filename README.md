# Ambient Glass

Ambient Glass turns a spare Windows laptop into a quiet, cinematic information display. It is a Tauri 2 + React + TypeScript desktop app designed around a restrained Liquid Glass composition: the wallpaper remains the artwork; time, weather, reminders, tasks, scores, and alarms surface only when useful.

The supplied visual source of truth is [design/reference/glance.png](design/reference/glance.png). The behavioral product plan is [PLAN.md](PLAN.md).

## What is implemented

- A polished, responsive 16:10 Liquid Glass preview matching the reference composition rather than a dashboard grid. Time and weather share one organic hero island; Calendar, Focus, GitHub, and a clean wallpaper beat rotate as one calm primary surface above a compact sports ribbon. The wide settings workspace keeps its header fixed and its content independently scrollable down to the 960×700 window minimum.
- A centralized display state machine: `booting`, `sleep`, `ambient`, `awakening`, `glance`, `interactive`, `alarm`, `celebration`, and `settings`.
- Deterministic preview controls through URL parameters and a shortcut-gated debug surface.
- Local-first repeating tasks, weekday routines, date-based completion, local reminders, one-per-day celebration logic, native app-active alarm scheduling with a browser-audio fallback, and a morning-briefing transition.
- Open-Meteo weather with local cache support, WMO normalization, sunrise/sunset day parts, scene hysteresis, and graceful fallback.
- Local MediaPipe face-detection pipeline with persisted opt-in camera permission, hidden low-resolution stream, one-second sampling, no frame storage or upload.
- Typed commands and explicit push-to-talk capture. Typed commands always work without credentials.
- Credential-backed native GitHub, TheSportsDB, optional OpenAI transcription, and optional Google Calendar boundaries. Google uses installed-app PKCE OAuth in the system browser, keeps refresh tokens in the OS credential store, and normalizes only today's display-safe events.
- Persisted favorite-team preferences for the sports ribbon. Up to eight ordered favorites can be added from the current feed or by name and optional TheSportsDB team ID; favorites can lead the calm status ordering or hide unrelated games entirely.
- An app-owned image/video wallpaper library with native multi-file import, local copies, gallery selection, single-wallpaper and no-repeat shuffle modes, configurable intervals, removal, and explicit source selection between **My wallpapers**, **Wallpaper Engine**, and **Calm fallback**. Browser preview uses bundled deterministic media and never reads user files.
- A narrow native Wallpaper Engine adapter that validates scene keys, specific wallpaper files, and executable layout before opening Wallpaper Engine in its named in-window surface behind the app; settings persist a default file, optional per-scene file overrides, manual scene lock, fallback choice, and app-window display selection.
- Tauri settings persistence, autostart, app-active native alarms, native notification, secure credentials, and Windows source configuration. These native behaviors require the Windows validation pass below.

## Run it

Prerequisites:

- Node.js 22+ (this workspace was verified with Node 26).
- Rust/Cargo plus the current [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for desktop builds.
- For Windows deployment: WebView2, Wallpaper Engine, and the Dell XPS itself for runtime validation.

```bash
npm install
npm run dev
```

Open `http://localhost:4173/?preview=1` for the deterministic browser preview.

Useful preview routes:

```text
/?preview=1&time=07:30&weather=clear&presence=1
/?preview=1&time=22:15&weather=rain&presence=1
/?preview=1&mode=ambient&presence=0
/?preview=1&mode=alarm
/?preview=1&mode=celebration
/?preview=1&mode=settings
/?preview=1&offline=1
```

Keyboard shortcuts:

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+Space` | Wake or hide Ambient Glass when available |
| `Ctrl+Shift+I` | Enter interactive mode |
| `Ctrl+Shift+D` | Toggle debug controls |
| `Ctrl+Shift+,` | Open settings |
| `Esc` | Exit settings/interactive mode |

## Verify

```bash
npm run verify
```

This runs Prettier, ESLint, TypeScript, unit tests, the production frontend build, and deterministic Playwright preview flows. Captures are written to [`artifacts/screenshots/`](artifacts/screenshots/), including clear/rainy glance, ambient, mid-reveal, alarm, celebration, settings, offline, and interactive-command states.

For the native shell after Rust is installed:

```bash
npm run tauri dev
npm run tauri build
```

## Daily-use setup

### Wallpapers

The default **My wallpapers** source is independent of Wallpaper Engine. In the native app, choose **Add wallpapers** to select multiple JPG/JPEG, PNG, WebP, MP4, or WebM files. Ambient Glass validates each file and copies it into its own local data directory, so moving or deleting the original does not break the display. The gallery can show any available item immediately, include or exclude items from the shuffle, remove app-owned copies, and open the managed folder.

Choose **Keep one** for a fixed wallpaper or **Shuffle selected** to cycle through every enabled item before refilling the random bag. The available intervals are 5, 15, 30, 60, 120, and 240 minutes. Images and muted looping videos crossfade behind the glass UI; the calm internal scene remains underneath so a missing or unreadable asset cannot create a blank display. Library preferences are non-secret local settings.

The browser preview shows bundled deterministic wallpapers so the complete source/gallery UI remains testable without filesystem access, credentials, or Windows-only APIs. Import, removal, and **Open folder** are native-only.

### Wallpaper Engine (optional)

Select **Wallpaper Engine** as the wallpaper source, then choose a specific Wallpaper Engine project or supported media file for the app background. In Wallpaper Engine, right-click the subscribed wallpaper, choose **Open in Explorer**, and copy the path to its `project.json` or packaged scene file. You can also use a supported video or web-wallpaper entry file. Paste that file path into **In-app wallpaper** in Ambient Glass settings.

```text
project.json
scene.pkg
background.mp4
background.webm
index.html
```

Set one default file first. Optional per-scene file overrides let clear, rainy, daytime, and nighttime scene keys select different files. Wallpaper Engine's `openPlaylist` command cannot use `-playInWindow`, so playlist names are intentionally not accepted for this integration.

The native adapter sends only the validated equivalent of:

```powershell
wallpaper64.exe -control openWallpaper -file "C:\path\to\project.json" -playInWindow "Ambient Glass Background" -width 1600 -height 900 -x 100 -y 100 -borderless
```

That render surface is positioned behind and kept aligned with the Ambient Glass client area. It does not replace the Windows desktop wallpaper and does not target a Wallpaper Engine monitor. Closing or hiding Ambient Glass closes or hides the in-app wallpaper surface as well. The adapter never exposes arbitrary shell execution to the webview. On non-Windows hosts it intentionally returns a mock result, while the browser preview uses the bundled internal background without credentials or Windows-only APIs.

### Weather and presence

Open settings, choose **Use current location**, then allow the browser/webview location prompt. Weather refreshes conservatively and uses its cache on failure. Camera access is never requested until you explicitly choose **Enable local camera presence**. That local opt-in is persisted in browser storage or Tauri Store, so later non-preview launches start the same local pipeline automatically; choose **Disable** to stop and release it immediately. The bundled MediaPipe model runs locally; frames are neither saved nor transmitted. If camera permission is denied or unavailable, browser input can wake the preview. In the native app, normal keyboard and pointer input remains available in every display mode, and `Ctrl+Shift+Space` is an additional recovery shortcut when it is not claimed by another program.

### Providers and secrets

Use the native settings surface to connect GitHub, TheSportsDB, and optional OpenAI transcription. Tokens are never placed in `VITE_*` variables, source, screenshots, or logs. Browser preview has no access to these provider paths and therefore uses deterministic mocks by design; a normal launch starts with no fabricated tasks, alarms, scores, commits, or events.

GitHub’s visible count is labeled **“commits today”** only when it represents `contributionsCollection.totalCommitContributions`; it is not mislabeled as all contributions. Sports are normalized before rendering, then sorted live → upcoming → final in one calm ribbon, with ordered favorites leading within each group. A favorite with a numeric TheSportsDB team ID also adds bounded previous/next schedule requests; a name-only favorite can still match and filter events already in the feed. The **Show only favorites** setting hides unrelated games once a favorite exists. Normalized same-day cache values remain visibly stale after a disconnect instead of becoming demo data. The local calendar/reminder layer remains usable when Google Calendar is disconnected.

### Google Calendar (optional)

Create a **Desktop app** OAuth client in your Google Cloud project, configure the consent screen for your account, then provide its public client ID only when building/running the native shell:

```bash
AMBIENT_GOOGLE_CLIENT_ID="your-desktop-client-id.apps.googleusercontent.com" npm run tauri dev
```

In native settings, choose **Connect Google Calendar**. Ambient Glass opens the authorization page in the system browser and receives the approved loopback callback with PKCE; the webview never receives an OAuth code, verifier, access token, or refresh token. The refresh token stays in the operating-system credential store. Today’s primary-calendar events appear alongside local reminders, and the settings form can create a bounded event in that same calendar. A missing client ID or revoked consent leaves the local-first calendar fully usable.

### Alarms and startup

Alarms work while Ambient Glass and the computer remain running. In a native build, a small app-active scheduler persists non-secret schedules/snoozes and emits the alarm event; the display loops its bundled local [`alarm-default.wav`](public/audio/alarm-default.wav) chime until snooze or dismiss, falling back to a dependency-free WebAudio chime if media playback is unavailable. It queues simultaneous alarms deterministically and sends a native notification when permission is granted. Enable native notification permission and autostart from settings in a desktop build. The scheduler does not wake a sleeping computer, and the sound is still played by the active webview rather than an independent native audio service, so leave the laptop powered and awake until a Windows Task Scheduler/audio enhancement is added and tested.

## Windows/Dell validation still required

This repository was browser-verified and native-source-checked on macOS. The full native GUI/package could not run here because full Xcode is unavailable, and Windows, Wallpaper Engine, and the Dell hardware are outside this host. **Windows/Dell runtime validation remains unverified.** Do not treat source or browser evidence as proof of desktop behavior. Perform and record these checks on the Dell:

1. Standard resizable taskbar window, title-bar close/minimize/maximize controls, hidden startup flash prevention, and responsive input in every app mode. At 960×700, confirm settings remain internally scrollable, the close control stays visible, and keyboard focus returns correctly.
2. Import multiple images and videos into the app-owned library; confirm copies survive moving the originals and an app restart, gallery selection and removal work, video playback is compatible with WebView2, shuffle visits enabled items without immediate repeats, source switching is reliable, and failed media reveals the calm fallback.
3. Select the optional Wallpaper Engine source. Confirm its configured file renders inside the app, remains aligned through move/resize/minimize/restore, and never changes the Windows desktop background; then test any clear/rain/day/night file overrides.
4. Webcam permission, local presence reveal/dismiss, keyboard/pointer recovery, `Ctrl+Shift+Space` recovery when available, and long-absence sleep.
5. Local task persistence, celebration, reminder, alarm, notification, and morning briefing.
6. Each configured provider independently, including secure token storage and revoked/disconnected behavior. Verify favorite-team ordering/filtering and numeric-ID schedule refreshes against TheSportsDB. Build with a configured Google Desktop client ID, complete the system-browser OAuth flow, verify today-sync/event creation, then revoke access and verify the local-first fallback.
7. Startup after a Windows restart, plus a 20-minute CPU/GPU/fan observation with app-owned video and Wallpaper Engine sources.
8. Offline fallback with network disconnected.

The exact current evidence and limits live in [artifacts/verification/p0-checklist.md](artifacts/verification/p0-checklist.md) and [PROGRESS.md](PROGRESS.md).

## Security notes

- No unrestricted shell, filesystem, process, or opener permissions are granted to the frontend. Google authorization is restricted to its expected host, and the custom wallpaper-folder command can open only Ambient Glass's fixed app-local library directory.
- App-owned wallpaper imports are bounded, structure-checked, content-addressed, and deduplicated. The Rust command owns the native picker, so original source paths never enter renderer memory and are neither persisted nor returned; renderer access is limited to the managed image/video asset scope.
- Wallpaper Engine executable and wallpaper-file input are validated twice and invoked through separated process arguments; no playlist or monitor targeting is exposed.
- Camera frames stay local and ephemeral.
- Ambient Glass no longer installs a Windows session-input poller; the normal app window receives its own keyboard and pointer events directly.
- Microphone capture happens only while the user explicitly holds the voice control; temporary audio is discarded after the native transcription request.
- Non-secret app state—including wallpaper source/shuffle choices and favorite teams—uses browser fallback storage during preview and Tauri Store in a native build. Secrets belong in the native credential boundary, never frontend bundles.

## Project layout

```text
src/             React UI, state integration, providers, and deterministic preview
src/domain/      Pure state machine, weather, tasks, alarms, commands, and tests
src-tauri/       Minimal native Tauri/Wallpaper Engine/security surface
tests/e2e/       Playwright deterministic preview flows
artifacts/       Screenshots and verification evidence
```
