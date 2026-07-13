# Ambient Glass progress

## Current milestone

The prior browser P0 and native Rust source-verification baseline is complete.
The latest refinement unifies time and weather in one organic hero island,
rotates one calm primary glance surface instead of presenting a dashboard grid,
makes settings a wide fixed-header workspace with an internally scrollable
body, adds an app-owned local image/video wallpaper library with source and
shuffle controls, and adds persisted favorite-team preferences. Wallpaper
Engine remains an optional in-app source configured from a specific file; it
is never commanded to replace the desktop background. A packaged Windows/Dell
runtime validation pass with real hardware remains unverified and mandatory.

## Completed evidence

- Read the supplied reference and `PLAN.md`; copied them to `design/reference/glance.png` and `PLAN.md`.
- Built the Liquid Glass React/Vite composition, deterministic preview routes,
  centralized display machine, local routines, reminders, alarms, celebration,
  weather/cache, presence opt-in, typed commands, and native source boundary.
- Replaced the detached weather capsule with one unified clock/weather hero
  surface. Calendar, focus tasks, GitHub, and a clean wallpaper beat now rotate
  as the single primary glance surface, with the compact sports ribbon kept
  secondary. Settings hide the ambient islands, keep the header/close control
  fixed while the body scrolls, fit the 960×700 minimum window, and manage
  open/close focus plus Escape behavior.
- Implemented native source for a conventional Tauri desktop window, optional global
  shortcuts, bounded app-owned wallpaper import, Wallpaper Engine in-window
  file control/retry, OS-keychain credentials, GitHub, TheSportsDB, optional
  OpenAI transcription, and Google Calendar. The Windows runtime remains
  source-complete but is not yet Dell-verified.
- Added installed-app Google OAuth with PKCE/loopback callback, system-browser
  authorization, keychain-only refresh storage, today-event normalization, and
  bounded primary-calendar event creation. It remains inert until a user builds
  with their own `AMBIENT_GOOGLE_CLIENT_ID` and completes consent.
- Added a non-secret Wallpaper Engine setup surface for a default wallpaper
  file, optional per-scene file overrides, manual scene lock, internal browser
  fallback, and a separately persisted app-window display selector. Playlist
  names are intentionally unsupported because Wallpaper Engine cannot combine
  `openPlaylist` with its in-window playback mode.
- Added a primary app-owned wallpaper source for JPG/JPEG, PNG, WebP, MP4, and
  WebM media. Native import copies structurally validated files into bounded,
  content-addressed app-local storage without returning source paths; settings
  expose a gallery, immediate selection, shuffle inclusion, 5–240 minute
  intervals, removal, folder reveal, and explicit source switching between the
  library, Wallpaper Engine, and the internal fallback. Browser preview uses
  bundled deterministic media only. Native source transitions are serialized,
  and stale async results cannot resurrect a source the user already left.
- Added non-secret sports preferences for up to eight ordered favorite teams.
  Favorites can prioritize or exclusively filter the ribbon; numeric
  TheSportsDB IDs add bounded previous/next schedule requests, while name-only
  entries still filter normalized events already in the feed. Refreshes are
  serialized behind a native request budget and stale frontend results are
  discarded.
- Added a native app-active alarm scheduler with durable non-secret schedules,
  snoozes, notification status, and event bridging to the existing alarm UI.
  Its active webview loops a generated, bundled local alarm chime and safely
  falls back to the existing dependency-free WebAudio chime. Native audio is
  still truthfully reported unavailable because the scheduler does not own an
  independent native audio service.
- Normal launches never seed preview fixtures. Same-day normalized GitHub and
  sports values persist as explicitly stale non-secret cache data.
- Verified the reference-like 1920×1200 and second 16:10 browser captures.
- Added focused Playwright assertions for unified hero containment and a
  960×700 settings flow covering internal scrolling, hidden ambient islands,
  focus-on-open, Escape, and trigger-focus restoration.
- Ran native Rust formatting, `cargo check`, 32 Rust unit tests, and Clippy
  with warnings denied on this macOS host. Added cross-platform application
  icons so Tauri context generation also completes during those checks.

## Latest verification

The complete current refinement suite passed from the repository root:

Run from the repository root:

```text
npm run format:check  PASS
npm run typecheck     PASS
npm run lint          PASS
npm run test          PASS — 17 files / 67 tests
npm run build         PASS
npm run test:e2e      PASS — 12 Chromium flows
cargo fmt --check     PASS
cargo check           PASS
cargo test            PASS — 32 tests
cargo clippy          PASS — warnings denied
```

The Chromium coverage includes 1920×1200 and 1440×900 compositions, a short
desktop layout, 960×700 settings scrolling/focus behavior, browser-safe
wallpaper and team persistence, local camera opt-in, commands, and a normal
launch that never presents preview fixtures as real data. The earlier P0
evidence remains recorded in `artifacts/verification/p0-checklist.md`.

## Screenshots produced

- `artifacts/screenshots/clear-evening-glance-1920x1200.png`
- `artifacts/screenshots/rainy-night-glance-1440x900.png`
- `artifacts/screenshots/ambient-no-ui-1920x1200.png`
- `artifacts/screenshots/mid-reveal-1920x1200.png`
- `artifacts/screenshots/alarm-1920x1200.png`
- `artifacts/screenshots/celebration-1920x1200.png`
- `artifacts/screenshots/settings-1920x1200.png`
- `artifacts/screenshots/settings-960x700.png`
- `artifacts/screenshots/offline-fallback-1920x1200.png`
- `artifacts/screenshots/interactive-commands-1440x900.png`
- `artifacts/screenshots/classy-sparse-dell-1917x1093.png`

## Genuine blockers / handoff

- This host now has Rust/Cargo and verifies the native source, including the
  checked-in `Cargo.lock`. Full Xcode is still absent, so a native macOS GUI
  launch/package was not attempted; Windows packaging must be done on the
  target Windows toolchain.
- Windows, the Dell XPS, WebView2 media behavior/transparency, Wallpaper Engine,
  microphone, and webcam runtime permissions are unavailable here. Windows/Dell
  validation remains mandatory and is intentionally not marked verified. In
  particular, exercise app-owned image/video import, persistence, playback,
  shuffle and source switching, then confirm the optional Wallpaper Engine
  surface stays behind and aligned through move/resize/minimize/restore and
  leaves the desktop wallpaper alone.
- A real favorite-team schedule refresh requires a configured TheSportsDB key,
  numeric team IDs, network access, and the native provider boundary. Browser
  preview remains deterministic and never claims that provider request occurred.
- Google Calendar source is complete but cannot be exercised without a
  user-owned Desktop OAuth client ID, Google consent, network access, and a
  native build. Its refresh token never enters frontend state.
