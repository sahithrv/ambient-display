# Ambient Glass progress

## Current milestone

Browser P0 implementation and native Rust source verification are complete.
The shell covers Google Calendar OAuth, app-active alarms, Wallpaper Engine
in-app file setup, and app-window display selection. Wallpaper Engine is now
configured from a specific project/video/web-wallpaper file and is never
commanded to replace the desktop background. The remaining work includes a
packaged Windows/Dell validation pass with real hardware.

## Completed evidence

- Read the supplied reference and `PLAN.md`; copied them to `design/reference/glance.png` and `PLAN.md`.
- Built the Liquid Glass React/Vite composition, deterministic preview routes,
  centralized display machine, local routines, reminders, alarms, celebration,
  weather/cache, presence opt-in, typed commands, and native source boundary.
- Implemented native source for a conventional Tauri desktop window, optional global
  shortcuts, bounded Wallpaper Engine in-window file control/retry, OS-keychain
  credentials, GitHub, TheSportsDB, optional OpenAI transcription, and Google
  Calendar. The Windows in-app background surface is source-complete but is
  not yet Dell-verified.
- Added installed-app Google OAuth with PKCE/loopback callback, system-browser
  authorization, keychain-only refresh storage, today-event normalization, and
  bounded primary-calendar event creation. It remains inert until a user builds
  with their own `AMBIENT_GOOGLE_CLIENT_ID` and completes consent.
- Added a non-secret Wallpaper Engine setup surface for a default wallpaper
  file, optional per-scene file overrides, manual scene lock, internal browser
  fallback, and a separately persisted app-window display selector. Playlist
  names are intentionally unsupported because Wallpaper Engine cannot combine
  `openPlaylist` with its in-window playback mode.
- Added a native app-active alarm scheduler with durable non-secret schedules,
  snoozes, notification status, and event bridging to the existing alarm UI.
  Its active webview loops a generated, bundled local alarm chime and safely
  falls back to the existing dependency-free WebAudio chime. Native audio is
  still truthfully reported unavailable because the scheduler does not own an
  independent native audio service.
- Normal launches never seed preview fixtures. Same-day normalized GitHub and
  sports values persist as explicitly stale non-secret cache data.
- Verified the reference-like 1920×1200 and second 16:10 browser captures.
- Ran native Rust formatting, `cargo check`, 19 Rust unit tests, and Clippy
  with warnings denied on this macOS host. Added cross-platform application
  icons so Tauri context generation also completes during those checks.

## Latest browser verification

Run from the repository root:

```text
npm run format:check  PASS
npm run typecheck     PASS
npm run lint          PASS
npm run test          PASS — 12 files / 42 tests
npm run build         PASS
npm run test:e2e      PASS — 10 Chromium flows
```

`npm run verify` completed successfully in one final run, including all 10
Chromium flows. The exact evidence is recorded in
`artifacts/verification/p0-checklist.md`.

## Screenshots produced

- `artifacts/screenshots/clear-evening-glance-1920x1200.png`
- `artifacts/screenshots/rainy-night-glance-1440x900.png`
- `artifacts/screenshots/ambient-no-ui-1920x1200.png`
- `artifacts/screenshots/mid-reveal-1920x1200.png`
- `artifacts/screenshots/alarm-1920x1200.png`
- `artifacts/screenshots/celebration-1920x1200.png`
- `artifacts/screenshots/settings-1920x1200.png`
- `artifacts/screenshots/offline-fallback-1920x1200.png`
- `artifacts/screenshots/interactive-commands-1440x900.png`
- `artifacts/screenshots/classy-sparse-dell-1917x1093.png`

## Genuine blockers / handoff

- This host now has Rust/Cargo and verifies the native source, including the
  checked-in `Cargo.lock`. Full Xcode is still absent, so a native macOS GUI
  launch/package was not attempted; Windows packaging must be done on the
  target Windows toolchain.
- Windows, WebView2 transparency, Wallpaper Engine, the Dell XPS, microphone,
  and webcam runtime permissions are unavailable here. The Dell smoke checklist
  remains mandatory and is intentionally not marked verified. In particular,
  confirm the Wallpaper Engine surface stays behind and aligned with the app
  through move/resize/minimize/restore and leaves the desktop wallpaper alone.
- Google Calendar source is complete but cannot be exercised without a
  user-owned Desktop OAuth client ID, Google consent, network access, and a
  native build. Its refresh token never enters frontend state.
