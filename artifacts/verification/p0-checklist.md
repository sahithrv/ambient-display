# P0 verification checklist

Last updated: 2026-07-09

This record distinguishes concrete browser evidence from source review and
Windows-only behavior. It does not infer Dell/WebView2 behavior from macOS.

| Area | Status | Evidence / next validation |
| --- | --- | --- |
| Reference-like 1920×1200 Liquid Glass composition | Browser verified | `artifacts/screenshots/clear-evening-glance-1920x1200.png`; visual inspection against `design/reference/glance.png` |
| Second responsive 16:10 composition | Browser verified | `artifacts/screenshots/rainy-night-glance-1440x900.png` |
| Wallpaper remains dominant / no dashboard grid | Browser verified | Final browser captures visually reviewed |
| Cohesive reveal/dismiss and reduced motion | Browser verified | `mid-reveal-1920x1200.png`, deterministic preview flow |
| Transparent native window, click-through, taskbar behavior | Implemented source; Windows unverified | Tauri config/windowing source; smoke-test on Dell/WebView2 |
| Global shortcut synchronization / emergency hide | Browser plus source verified; Windows unverified | Display-machine tests, Playwright recovery flow, native event payload review; test actual Windows registration |
| Weather cache, WMO mapping, day parts, real humidity/wind | Browser/unit verified | Domain + provider tests; live location needs an actual user grant |
| Wallpaper playlist validation, mapping/lock/fallback setup, duplicate suppression, retry | Browser/Rust source verified; Windows unverified | Persisted configuration/unit tests plus native allowlist/retry source; requires Wallpaper Engine test on Dell |
| Local routines, weekday recurrence, date reset, celebration | Browser verified | Unit tests plus `tests/e2e/routines.spec.ts` and typed-command flow |
| Active-process alarm, queue, repeat chime, morning transition | Browser/Rust source verified; device runtime unverified | Bundled local chime + fallback, 9 scheduler resilience tests, native event source; notification/audio device behavior needs Dell test |
| Local MediaPipe presence / persisted consent | Browser source/e2e verified; hardware unverified | Camera lifecycle and preview persistence flow; test real camera on Dell |
| GitHub count and sports normalization/cache | Source/browser-contract verified; real credentials unverified | Backend-only adapter, validated stale cache, no demo leakage; connect each service on Dell |
| Google Calendar OAuth | Implemented source; real connection unverified | Installed-app PKCE + loopback, native keychain token storage, today sync, and event creation. Requires a user-owned Desktop client ID, consent, native build, and Google account test. |
| Typed commands | Browser verified | Reminder/task/complete/scene flows in Playwright |
| Push-to-talk / native transcription | Source verified; microphone/provider unverified | Explicit bounded capture and backend boundary; test with OpenAI credential on Dell |
| Non-secret persistence / secret boundary | Browser/Rust source verified; native runtime unverified | Isolated preview storage, Tauri Store source, fixed OS-keyring slots; exercise OS keyring on Dell |
| Startup and native notifications | Implemented source; Windows unverified | Autostart/notification plugins; validate installed app after reboot |
| Offline/stale fallback | Browser verified | `offline-fallback-1920x1200.png`, cache/unit tests, normal-launch no-fixture flow |
| Formatting, lint, types, unit tests, frontend build, E2E | Browser verified | Final `npm run verify` passed format/lint/typecheck, 12 Vitest files / 42 tests, production build, and 8/8 Chromium flows |
| Native Rust source / package | Rust source verified; package/Windows unverified | `cargo fmt`, check, 19 tests, and Clippy `-D warnings` pass on macOS; full Xcode and Windows target hardware are unavailable for a package/runtime test |

## Windows/Dell smoke checklist

Run and record on the target Dell before claiming desktop completion:

1. Build the native app from the checked-in `Cargo.lock` on the Dell Windows toolchain.
2. Verify transparent borderless fullscreen window, skip-taskbar, click-through,
   startup flash prevention, and each global shortcut.
3. Start Wallpaper Engine, test all configured playlists, and observe automatic
   clear/rain/day/night transitions and failure recovery.
4. Grant/deny webcam permission; verify reveal/dismiss, sleep, Windows
   session-input wake while click-through is active, and `Ctrl+Shift+Space`
   recovery.
5. Verify local task/reminder/alarm persistence, repeating alarm audio,
   notification permission, and morning briefing while the laptop stays awake.
6. Connect GitHub, TheSportsDB, OpenAI transcription, and any configured Google
   OAuth client independently; test revoked/offline state.
7. Restart Windows with autostart enabled and observe CPU/GPU/fan behavior for
   at least 20 minutes with Wallpaper Engine active.

## Final-run evidence

2026-07-09 final checkpoint: `npm run verify` passed Prettier, ESLint,
TypeScript, **12 Vitest files / 42 tests**, the production Vite build, and
**8/8 Chromium Playwright flows** in one run. Native verification also passed
`cargo fmt --check`, `cargo check`, **19 Rust tests**, and
`cargo clippy -- -D warnings`. Full native packaging, Windows compilation, and
Dell/WebView2/Wallpaper Engine behavior remain intentionally unverified.
