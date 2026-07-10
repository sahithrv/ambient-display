# Ambient Glass progress

## Current milestone

Browser P0 implementation and native Rust source verification are complete.
The shell covers Google Calendar OAuth, app-active alarms, Wallpaper Engine
setup, and overlay-monitor selection. The remaining work is a packaged
Windows/Dell validation pass with real credentials and hardware.

## Completed evidence

- Read the supplied reference and `PLAN.md`; copied them to `design/reference/glance.png` and `PLAN.md`.
- Built the Liquid Glass React/Vite composition, deterministic preview routes,
  centralized display machine, local routines, reminders, alarms, celebration,
  weather/cache, presence opt-in, typed commands, and native source boundary.
- Implemented native source for transparent Tauri window modes, fixed global
  shortcuts, bounded Wallpaper Engine control/retry, OS-keychain credentials,
  GitHub, TheSportsDB, optional OpenAI transcription, and Google Calendar.
- Added installed-app Google OAuth with PKCE/loopback callback, system-browser
  authorization, keychain-only refresh storage, today-event normalization, and
  bounded primary-calendar event creation. It remains inert until a user builds
  with their own `AMBIENT_GOOGLE_CLIENT_ID` and completes consent.
- Added a non-secret Wallpaper Engine setup surface for all playlist mappings,
  manual scene lock, internal fallback, Wallpaper Engine monitor, and a
  separately persisted overlay display selector.
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
npm run test:e2e      PASS — 8 Chromium flows
```

`npm run verify` completed successfully in one final run, including all 8
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

## Genuine blockers / handoff

- This host now has Rust/Cargo and verifies the native source, including the
  checked-in `Cargo.lock`. Full Xcode is still absent, so a native macOS GUI
  launch/package was not attempted; Windows packaging must be done on the
  target Windows toolchain.
- Windows, WebView2 transparency, Wallpaper Engine, the Dell XPS, microphone,
  and webcam runtime permissions are unavailable here. The Dell smoke checklist
  remains mandatory and is intentionally not marked verified.
- Google Calendar source is complete but cannot be exercised without a
  user-owned Desktop OAuth client ID, Google consent, network access, and a
  native build. Its refresh token never enters frontend state.
