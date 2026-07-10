# Ambient Glass
## Product and implementation plan

**Working title:** Ambient Glass  
**Repository name:** `ambient-glass`  
**Target device:** Dell XPS 15 (2020), Windows 10/11 x64, Wallpaper Engine installed  
**Primary display shape:** 16:10  
**Primary design canvas:** Use the laptop’s actual native resolution. Use `1920 × 1200` as the default mock and test viewport if the exact panel resolution is not yet known.  
**Product priority:** 1) beauty, 2) automatic atmosphere, 3) glanceable usefulness, 4) interaction  
**Visual reference path:** `design/reference/glance.png`  
**Optional additional references:** `design/reference/ambient.png`, `design/reference/alarm.png`, `design/reference/celebration.png`

---

# 1. Product vision

Ambient Glass turns an older Windows laptop into a piece of living room decor: a cinematic Wallpaper Engine scene that changes with local time and weather, plus an elegant “Liquid Glass” information layer that materializes when a person approaches.

The result must not look like a conventional productivity dashboard. It should feel like an environmental display or a piece of digital furniture. Information is temporary, restrained, and subordinate to the scene.

The core experience is:

1. Wallpaper Engine provides the animated environment.
2. A full-screen transparent Tauri application remains running above the desktop.
3. When nobody is nearby, the application is visually absent or in an optional black sleep state.
4. Local face detection notices that someone has approached.
5. Liquid-glass islands grow into view with a controlled 700–1,000 ms animation.
6. The display shows only the most relevant information for that moment.
7. The information recedes after the user leaves.
8. Time and weather choose the Wallpaper Engine playlist automatically.
9. Voice, tasks, calendar, sports, GitHub, alarms, and celebrations add utility without turning the display into a busy control panel.

---

# 2. Scope and honest build target

A beautiful **hero prototype** is achievable quickly. A reliable daily-use application with OAuth, alarms, camera behavior, remote APIs, secure token storage, offline handling, and Windows startup behavior is not a one-hour implementation.

Use two finish lines:

## 2.1 Hero demo finish line

The hero demo should be prioritized first and should include:

- Transparent, borderless, full-screen overlay.
- Wallpaper Engine visible underneath.
- A polished Liquid Glass reveal and dismissal animation.
- Clock, weather, next calendar item, task progress, GitHub count, and sports ticker using mock data.
- Live weather and automatic Wallpaper Engine playlist switching.
- A demo control panel that can simulate time, weather, presence, alarms, and task completion.
- A screen-recordable composition suitable for a LinkedIn post.

This can be built before authentication-heavy integrations.

## 2.2 Daily-use finish line

The complete build additionally includes:

- Local webcam presence detection.
- Real GitHub data.
- Real sports schedules and scores.
- Local reminders and optional Google Calendar synchronization.
- Repeating daily tasks.
- Push-to-talk voice commands.
- Alarm and morning briefing.
- Secure credential storage.
- Automatic startup.
- Offline and failure states.
- Windows-specific runtime validation.

Codex should reach the hero-demo checkpoint early, then continue toward the daily-use finish line.

---

# 3. Product principles

## 3.1 Ambient art first

The wallpaper should remain the dominant visual element. The overlay should normally occupy no more than roughly 20–30% of the display area.

## 3.2 Automatic by default

The display should not require routine navigation. Time, weather, presence, event proximity, alarms, and task completion drive the experience.

## 3.3 Glanceable, not browsable

The user should understand the display from across the room in two or three seconds. Detailed settings may exist, but they should be hidden behind a global shortcut.

## 3.4 Calm motion

Transitions should feel fluid and intentional. Avoid constant bouncing, neon HUD animations, fast marquees, or decorative motion that competes with the wallpaper.

## 3.5 Graceful degradation

Every remote integration is optional. Missing credentials or an unavailable service must never create an ugly error panel. The corresponding module should either show cached data, enter a tasteful “unavailable” state, or disappear.

## 3.6 Local privacy

The webcam is used only for face/no-face presence detection. Frames are processed locally, are never stored, and are never sent to a remote service.

## 3.7 Visual quality before feature density

A smaller number of beautifully composed modules is better than nine visible widgets.

---

# 4. Target experience and state machine

Implement a single explicit state machine. Do not scatter visibility logic across unrelated components.

```ts
type DisplayMode =
  | "booting"
  | "sleep"
  | "ambient"
  | "awakening"
  | "glance"
  | "interactive"
  | "alarm"
  | "celebration"
  | "settings";
```

## 4.1 Booting

**Duration:** approximately 1–2 seconds.

Behavior:

- The Tauri window launches hidden to avoid a white or black flash.
- Configuration and cached data load.
- Wallpaper Engine availability is checked.
- The correct scene key is calculated.
- The Tauri window appears only after transparent rendering is ready.
- The display enters `ambient` or `sleep`.

Visual:

- No spinner.
- If a transition is needed, use a very subtle fade from black.

## 4.2 Sleep

This is an optional “screen appears off” state after prolonged absence.

Behavior:

- A pure-black full-screen layer fades to full opacity.
- The application remains alive.
- Presence detection continues at a low rate.
- Remote polling is reduced.
- Wallpaper Engine may be paused to reduce load.
- The computer must remain awake if presence wake is expected.

Entry recommendation:

- No face for 10 minutes, configurable.

Exit:

- A face is detected consistently.
- Keyboard or mouse activity occurs.
- An alarm fires.

## 4.3 Ambient

Behavior:

- Wallpaper Engine is fully visible.
- All major UI is visually absent.
- An optional minimal clock and temperature may remain at 10–20% opacity if the final mock calls for it.
- The window ignores pointer events.

Exit:

- Face detected in at least 2 of the last 3 sampled frames.
- Global wake shortcut.
- Alarm.

## 4.4 Awakening

**Duration:** 700–1,000 ms.

Animation sequence:

| Time | Action |
|---:|---|
| 0 ms | A small specular droplet or orb appears near the hero clock anchor. |
| 100 ms | The droplet scales from approximately 0.4 to 1.08 with a spring curve. |
| 180 ms | The main glass island stretches horizontally using a clip-path or FLIP layout animation. |
| 300 ms | A secondary weather capsule separates from or merges with the hero island. |
| 420 ms | Clock and greeting appear with a short upward fade. |
| 520 ms | Next event and task progress resolve into view. |
| 650 ms | GitHub micro-stat appears. |
| 750 ms | Sports ribbon begins its first slow movement. |
| 900 ms | The state becomes `glance`. |

Important:

- Never distort readable text.
- Any SVG displacement should affect only edge highlights or decorative layers.
- Animate transforms, opacity, and clip paths rather than expensive full-screen blur values.

## 4.5 Glance

This is the default visible state while a person is present.

Recommended composition:

- Large time and greeting.
- Weather capsule.
- One primary information island that rotates between calendar, tasks, and GitHub.
- A single sports ribbon near the lower edge.
- No settings controls.
- Pointer events remain ignored unless the user explicitly enters interactive mode.

Content timing:

- Next calendar event: 8 seconds.
- Daily tasks/progress: 8 seconds.
- GitHub activity: 6 seconds.
- Mostly-clean hero view: 8 seconds.
- Sports ribbon can move continuously but very slowly.

Do not rotate content while the user is speaking, an alarm is active, or a celebration is playing.

## 4.6 Interactive

Entered by:

- Global shortcut.
- Clicking a temporarily enabled interaction target.
- Voice command such as “show my tasks.”

Behavior:

- Pointer events are enabled.
- A compact command orb and task controls become available.
- The glass UI may expand, but it should still preserve the wallpaper.
- Automatically return to `glance` after inactivity.

## 4.7 Alarm

Behavior:

- Overrides all other modes.
- Restores the window and audio.
- Shows a large, calm alarm composition with time, label, snooze, and dismiss.
- On dismissal in the morning, transitions directly into a morning briefing:
  - Weather.
  - First calendar event.
  - Daily task count.
  - One sports result or upcoming favorite-team game.

Reliability note:

- An alarm implemented only inside a running app is not guaranteed to fire if Windows sleeps, hibernates, restarts, changes audio devices, or terminates the process.
- The first build should clearly state that the laptop must remain powered and awake.
- A future reliability enhancement can create Windows Task Scheduler wake tasks.

## 4.8 Celebration

Trigger:

- All required daily tasks transition from incomplete to complete.
- Play at most once per date unless manually replayed.

Visual direction:

- Do not use generic website confetti by default.
- Integrate the celebration with the current atmosphere:
  - Clear day: prismatic light sweep and floating glass particles.
  - Night: shooting stars or distant fireflies.
  - Rain: droplets catch light and ripple through the glass.
  - Snow: a brief sparkling drift.
- Duration: 3–5 seconds.
- Return to the prior state afterward.

---

# 5. Wallpaper Engine strategy

Wallpaper Engine owns the animated scene. Ambient Glass owns orchestration and information.

## 5.1 Playlist naming

Create playlists with exact, stable names. Start with this compact set:

```text
AG Clear Dawn
AG Clear Day
AG Clear Sunset
AG Clear Night
AG Cloudy Day
AG Cloudy Night
AG Rain Day
AG Rain Night
AG Storm
AG Fog
AG Snow
AG Fallback
```

The application should map internal scene keys to user-editable playlist names so the names can change later without code edits.

Example non-secret configuration:

```json
{
  "clear.dawn": "AG Clear Dawn",
  "clear.day": "AG Clear Day",
  "clear.sunset": "AG Clear Sunset",
  "clear.night": "AG Clear Night",
  "cloudy.day": "AG Cloudy Day",
  "cloudy.night": "AG Cloudy Night",
  "rain.day": "AG Rain Day",
  "rain.night": "AG Rain Night",
  "storm.any": "AG Storm",
  "fog.any": "AG Fog",
  "snow.any": "AG Snow",
  "fallback.any": "AG Fallback"
}
```

## 5.2 Art-direction rules for wallpaper selection

Every selected wallpaper should belong to one coherent visual family.

Recommended direction:

- Cinematic, realistic or painterly landscapes.
- Similar camera height and visual depth.
- Minimal high-contrast text or characters.
- Important subject matter should not sit behind the planned UI anchors.
- Slow loops with no obvious hard cuts.
- Similar color grading across each time-of-day group.
- Avoid mixing anime, pixel art, photorealism, cyberpunk HUDs, and nature photography in one experience.

Put 2–4 wallpapers in each main playlist. More variety is not automatically better.

## 5.3 Automatic scene selection

Calculate a scene key from two axes:

```ts
type WeatherFamily =
  | "clear"
  | "cloudy"
  | "rain"
  | "storm"
  | "fog"
  | "snow"
  | "fallback";

type DayPart = "dawn" | "day" | "sunset" | "night";
```

Day parts should use the weather service’s sunrise and sunset times rather than hard-coded hours.

Recommended ranges:

- `dawn`: sunrise minus 45 minutes through sunrise plus 75 minutes.
- `day`: after dawn through sunset minus 75 minutes.
- `sunset`: sunset minus 75 minutes through sunset plus 45 minutes.
- `night`: all remaining time.

Use WMO weather codes from Open-Meteo and normalize them:

- Clear or mainly clear → `clear`.
- Partly cloudy, overcast → `cloudy`.
- Drizzle, rain, showers, freezing rain → `rain`.
- Thunderstorm → `storm`.
- Fog or depositing rime fog → `fog`.
- Snowfall or snow showers → `snow`.
- Unknown or unavailable → `fallback`.

## 5.4 Switching safeguards

- Fetch weather every 15 minutes.
- Recalculate day part every minute.
- Switch only when the calculated scene key changes.
- Apply a 5–10 minute weather hysteresis so a brief API fluctuation does not repeatedly swap playlists.
- Do not issue duplicate Wallpaper Engine commands.
- Log scene changes without logging credentials.
- Provide a manual scene lock in settings.
- Provide a “test scene” action for every mapped playlist.

## 5.5 Wallpaper Engine command

Wallpaper Engine supports named playlist control:

```powershell
wallpaper64.exe -control openPlaylist -playlist "AG Rain Night" -monitor 0
```

Implement this as a narrow Rust command rather than exposing an unrestricted shell to the webview.

The Rust command must:

1. Resolve the configured Wallpaper Engine executable.
2. Validate that the requested playlist is one of the configured values.
3. Pass each command argument separately to `std::process::Command`.
4. Never concatenate untrusted input into a shell string.
5. Return structured success/error data.
6. Work as a no-op mock on non-Windows development systems.

Suggested auto-detection order:

1. User-configured path.
2. Default Steam path under `Program Files (x86)`.
3. Steam install path discovered from the Windows registry.
4. Display a setup prompt if still unresolved.

## 5.6 Workshop usage

Do not redistribute downloaded Workshop files. For a public video or LinkedIn post:

- Credit the wallpaper creator in the post or video description.
- Do not imply that the background artwork was created as part of Ambient Glass.
- Do not package Workshop content into the application installer.
- Let each user subscribe to their own wallpaper collection.

---

# 6. Liquid Glass visual system

The application should evoke Liquid Glass without pretending that a one-hour web overlay can perform full optical refraction of another application’s pixels.

## 6.1 Rendering constraint

Wallpaper Engine and the Tauri webview are separate rendering surfaces. CSS `backdrop-filter` must be treated as progressive enhancement, not as the foundation of the design. It may not reliably sample or blur external desktop pixels through every WebView2/Windows composition path.

The P0 design should look excellent using:

- Transparent and translucent fills.
- Edge highlights.
- Inner reflections.
- Directional gradients.
- Controlled shadow.
- Fine noise.
- Subtle caustic-like light.
- Organic shape motion.
- A restrained edge vignette behind important text.

A later native experiment may use Tauri’s whole-window acrylic/blur effects or specialized native panel windows, but P0 must not depend on them.

## 6.2 Glass component anatomy

Every glass island should be built from layers:

```text
GlassIsland
├── shadow layer
├── tint/body layer
├── optional progressive backdrop blur layer
├── edge stroke layer
├── inner highlight layer
├── caustic/specular layer
├── subtle noise layer
└── content layer
```

Recommended starting tokens:

```css
:root {
  --glass-fill-dark: rgba(10, 14, 22, 0.34);
  --glass-fill-light: rgba(255, 255, 255, 0.14);
  --glass-stroke: rgba(255, 255, 255, 0.24);
  --glass-stroke-soft: rgba(255, 255, 255, 0.10);
  --glass-highlight: rgba(255, 255, 255, 0.42);
  --glass-shadow: rgba(0, 0, 0, 0.28);
  --glass-radius-lg: 40px;
  --glass-radius-md: 28px;
  --glass-radius-pill: 999px;
  --glass-blur-progressive: 18px;
}
```

These are starting values, not fixed requirements. The reference image is the visual source of truth.

## 6.3 Adaptive contrast

Wallpaper brightness varies. Add a scene-level contrast profile:

```ts
type ContrastProfile = "light-scene" | "dark-scene" | "mixed-scene";
```

Each playlist mapping may specify a preferred profile.

- `dark-scene`: lighter glass and white text.
- `light-scene`: darker glass and dark or high-shadow text.
- `mixed-scene`: dark glass with stronger edge stroke.

Also add subtle full-screen edge shading, never a heavy global dark filter:

```css
.scene-vignette {
  background:
    linear-gradient(90deg, rgba(0,0,0,.28), transparent 42%),
    linear-gradient(0deg, rgba(0,0,0,.20), transparent 35%);
}
```

## 6.4 Typography

Prefer Windows-native typography so the app stays visually consistent and has no font licensing or packaging burden.

Recommended stack:

```css
font-family:
  "Segoe UI Variable Display",
  "Segoe UI Variable Text",
  "Segoe UI",
  system-ui,
  sans-serif;
```

Suggested scale at 1920 × 1200:

- Hero time: 96–132 px, medium or semibold.
- Greeting: 22–30 px.
- Primary event: 22–28 px.
- Supporting label: 12–15 px, uppercase only when restrained.
- Ticker: 15–18 px.
- Micro-stat: 13–16 px.

Use `clamp()` and viewport-relative scaling to support high-DPI 16:10 screens.

## 6.5 Layout

Default 1920 × 1200 composition:

- **Hero clock island:** left side, vertically around 36–48% of the screen.
- **Weather capsule:** attached to or slightly above the clock island.
- **Primary rotating island:** below the clock, aligned to the same left axis.
- **GitHub micro-stat:** integrated into the primary island rather than a separate dashboard card.
- **Sports ribbon:** near the bottom, inset from both edges.
- **Voice orb:** lower-right only in interactive mode.
- **No persistent top navigation.**
- **No grid of cards.**

Use safe margins of approximately 4–6% of the shorter screen dimension.

## 6.6 Motion language

Use spring-like movement with minimal overshoot.

Recommended easing families:

```css
--ease-liquid: cubic-bezier(0.16, 1, 0.3, 1);
--ease-soft-out: cubic-bezier(0.22, 1, 0.36, 1);
--ease-soft-in: cubic-bezier(0.64, 0, 0.78, 0);
```

Motion rules:

- Reveal duration: 700–1,000 ms.
- Content fade: 180–320 ms.
- Module crossfade: 350–500 ms.
- Dismiss: 500–750 ms.
- Sports movement: slow enough to read from across the room.
- Avoid more than three simultaneous focal animations.

Use the `motion` library or an equivalent current React animation library. Use layout/FLIP animation for glass-island shape changes.

## 6.7 Progressive visual enhancements

Add behind feature flags only after the base design is stable:

- CSS `backdrop-filter`.
- SVG turbulence on edge highlights.
- Whole-window Tauri acrylic.
- Dynamic highlight movement based on cursor or face position.
- Native per-panel acrylic windows.
- Desktop capture and shader-based true refraction.

None of these may block P0 completion.

---

# 7. UI mock requirements

Before the final visual-polish pass, place the primary image at:

```text
design/reference/glance.png
```

Recommended mock dimensions:

```text
1920 × 1200
```

The primary mock should show:

- A representative Wallpaper Engine-style background.
- The overlay in its fully revealed `glance` state.
- The intended time, weather, event, tasks/GitHub, and sports composition.
- Exact desired spacing, radii, transparency, edge highlights, and typography character.
- No browser chrome, taskbar, desktop icons, or visible application frame.

Optional additional mocks:

```text
design/reference/ambient.png
design/reference/alarm.png
design/reference/celebration.png
design/reference/settings.png
```

Codex should treat the image as the visual source of truth and the written plan as the behavioral source of truth.

## 7.1 Preview mode for visual testing

A transparent production window is difficult to compare in a browser screenshot. Implement a preview-only background layer.

Preview routes or query parameters:

```text
/?preview=1
/?preview=1&time=07:30&weather=clear&presence=1
/?preview=1&time=22:15&weather=rain&presence=1
/?preview=1&mode=alarm
/?preview=1&mode=celebration
```

In preview mode:

- Render a local test background beneath the overlay.
- Allow deterministic time, weather, provider data, and presence.
- Never invoke Wallpaper Engine.
- Make Playwright screenshots deterministic.
- Provide an unobtrusive debug panel opened by a shortcut rather than visible in normal screenshots.

---

# 8. Technical architecture

## 8.1 Recommended stack

- **Desktop shell:** Tauri 2.
- **Frontend:** React, TypeScript, Vite.
- **State:** Zustand or a similarly small predictable store.
- **Async data/cache:** TanStack Query.
- **Validation:** Zod.
- **Animation:** Motion for React or equivalent.
- **Date parsing:** `chrono-node` for natural-language command dates plus a reliable date utility.
- **Presence:** `@mediapipe/tasks-vision`.
- **Testing:** Vitest, React Testing Library, Playwright.
- **Backend HTTP:** Rust `reqwest`.
- **Local asynchronous work:** Tokio.
- **Non-secret settings:** Tauri Store plugin.
- **Secrets/tokens:** Tauri Stronghold plugin or Windows Credential Manager through a narrow Rust abstraction.
- **Native notifications:** Tauri Notification plugin.
- **Startup:** Tauri Autostart plugin.
- **Global shortcuts:** Tauri Global Shortcut plugin.
- **Logging:** Tauri Logging plugin with secret redaction.

Use current stable versions at implementation time. Do not pin invented or stale versions from this document.

## 8.2 Layering

```text
Windows Desktop
└── Wallpaper Engine animated wallpaper
    └── Transparent full-screen Tauri window
        ├── optional black sleep cover
        ├── subtle scene vignette
        ├── Liquid Glass islands
        ├── content modules
        ├── celebration layer
        └── hidden settings/debug surfaces
```

## 8.3 Tauri window behavior

Production window configuration should target:

- Transparent.
- Borderless/decorations off.
- Fullscreen on the selected monitor.
- Skipped in taskbar.
- Always on top while display mode is active.
- No default shadow.
- Hidden until initialization is complete.
- Pointer events ignored in ambient/glance mode.
- Pointer events restored in interactive/settings/alarm mode.
- A global shortcut toggles display mode or hides the overlay.

Suggested shortcuts:

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Show/hide or wake overlay |
| `Ctrl+Shift+I` | Enter interactive mode |
| `Ctrl+Shift+D` | Toggle demo/debug controls |
| `Ctrl+Shift+,` | Open settings |
| `Esc` | Exit settings/interactive mode |

On a non-Windows development host, preserve the UI and provider mocks, but replace Windows-specific commands with explicit mock adapters.

## 8.4 Suggested repository layout

```text
ambient-glass/
├── PLAN.md
├── README.md
├── AGENTS.md
├── .env.example
├── package.json
├── vite.config.ts
├── design/
│   ├── reference/
│   │   └── glance.png
│   └── captures/
├── public/
│   ├── models/
│   │   └── face-detector.task
│   ├── audio/
│   │   └── alarm-default.*
│   └── preview/
│       └── background.*
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   └── providers.tsx
│   ├── components/
│   │   ├── glass/
│   │   │   ├── GlassIsland.tsx
│   │   │   ├── GlassCapsule.tsx
│   │   │   └── LiquidEdge.tsx
│   │   ├── HeroClock.tsx
│   │   ├── WeatherCapsule.tsx
│   │   ├── DailyBrief.tsx
│   │   ├── SportsRibbon.tsx
│   │   ├── VoiceOrb.tsx
│   │   ├── AlarmView.tsx
│   │   └── CelebrationLayer.tsx
│   ├── features/
│   │   ├── calendar/
│   │   ├── github/
│   │   ├── presence/
│   │   ├── reminders/
│   │   ├── sports/
│   │   ├── tasks/
│   │   ├── voice/
│   │   ├── wallpaper/
│   │   └── weather/
│   ├── state/
│   │   ├── displayMachine.ts
│   │   └── store.ts
│   ├── styles/
│   │   ├── tokens.css
│   │   ├── glass.css
│   │   └── globals.css
│   ├── preview/
│   │   ├── PreviewControls.tsx
│   │   └── fixtures.ts
│   └── test/
├── src-tauri/
│   ├── capabilities/
│   ├── src/
│   │   ├── commands/
│   │   ├── providers/
│   │   ├── scheduler/
│   │   ├── storage/
│   │   ├── wallpaper/
│   │   ├── windowing/
│   │   └── lib.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tests/
│   ├── e2e/
│   ├── fixtures/
│   └── visual/
└── artifacts/
    ├── screenshots/
    └── verification/
```

---

# 9. Data model and provider boundaries

Every integration should implement a provider interface and return normalized app models. The UI must never depend directly on a third-party response shape.

```ts
type ProviderStatus = {
  state: "ready" | "loading" | "stale" | "offline" | "needs-auth" | "error";
  lastUpdated?: string;
  message?: string;
};

interface DataProvider<T> {
  getStatus(): ProviderStatus;
  refresh(): Promise<T>;
  getCached(): T | null;
}
```

Remote providers should:

- Cache the last successful response.
- Use request timeouts.
- Retry conservatively with backoff.
- Expose stale data rather than flashing empty panels.
- Hide technical errors from the ambient UI.
- Surface actionable diagnostics only in settings.

---

# 10. Integration plans

## 10.1 Weather

**Provider:** Open-Meteo.

Required values:

- Current temperature.
- Apparent temperature.
- Weather code.
- Is-day flag where available.
- Sunrise and sunset.
- Daily high and low.
- Optional precipitation probability.

Behavior:

- User enters location once or grants location access.
- Persist latitude, longitude, display name, and time zone.
- Fetch every 15 minutes.
- Cache the last successful response.
- Use `timezone=auto` or the explicitly configured IANA time zone.
- Weather changes the Wallpaper Engine scene family.
- Time and sunrise/sunset change the day part.

Failure behavior:

- Use cached weather with no intrusive warning.
- If no cache exists, use the `fallback` scene and show only time.

## 10.2 GitHub

Desired UI wording:

- Prefer **“X commits today”** when using `totalCommitContributions`.
- A small sublabel may say “counted by GitHub.”
- If using the broader contribution calendar count instead, label it **“X contributions today,”** not commits.

Recommended GraphQL query:

```graphql
query TodayCommits($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
    }
  }
}
```

Implementation:

- Convert the configured local day’s start and end into ISO date-times.
- Store the GitHub token securely.
- Refresh every 5 minutes while awake and every 15 minutes while absent.
- Show zero naturally; do not treat zero as an error.
- Optionally show the number of repositories contributed to.
- Do not display repository names unless explicitly enabled.

Authentication:

- GraphQL requires authentication.
- Request only the permissions needed.
- Private/internal contribution visibility depends on token permissions and GitHub settings.

## 10.3 Sports

**Initial provider:** TheSportsDB through a provider abstraction.

Normalized event:

```ts
type SportsEvent = {
  id: string;
  sport: string;
  league: string;
  startTime: string;
  homeName: string;
  awayName: string;
  homeBadgeUrl?: string;
  awayBadgeUrl?: string;
  homeScore?: number;
  awayScore?: number;
  status: "scheduled" | "live" | "final" | "postponed" | "cancelled";
  clockOrPeriod?: string;
};
```

Settings:

- Favorite leagues.
- Favorite teams.
- Display order.
- Whether to show major non-favorite events.
- Quiet hours.

UI behavior:

- All sports appear in one ribbon.
- Group and order by live, upcoming, then final.
- Favorite teams receive priority.
- Use slow horizontal movement or discrete paged transitions; do not use a frantic news ticker.
- Pause motion briefly after a new item enters so it can be read.
- If there are no events, hide the ribbon instead of showing an empty state.

Refresh:

- Live events: approximately every 60 seconds if the provider tier supports them.
- Scheduled/final events: every 5–15 minutes.
- Respect provider limits.

Important:

- TheSportsDB free and premium capabilities differ. Build the provider so a different sports API can replace it without changing the UI.

## 10.4 Calendar and reminders

Use a local-first model.

### Local calendar/reminder layer

This is always available and powers voice-created reminders even when Google is disconnected.

```ts
type Reminder = {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
  recurrence?: string;
  notificationOffsetsMinutes: number[];
  source: "local" | "google";
  externalId?: string;
};
```

Capabilities:

- Create a one-time reminder.
- Create daily/weekday recurrence.
- Show today’s items.
- Fire native notifications while the app is running.
- Show an in-app alarm-like reminder when configured.
- Persist in local storage.

### Google Calendar adapter

Optional connection:

- OAuth 2.0 installed-app flow.
- Minimal calendar event scopes required for reading and creating events.
- Store refresh tokens securely.
- Fetch today’s events using local-day boundaries.
- Create events using the Calendar `events.insert` endpoint.
- Deduplicate local and Google items using `externalId`.
- Handle revoked access gracefully.

Do not block the rest of the app on Google OAuth.

## 10.5 Repeating daily to-do list

Task definition:

```ts
type RepeatingTask = {
  id: string;
  title: string;
  enabled: boolean;
  daysOfWeek: number[];
  requiredForCelebration: boolean;
  preferredTime?: string;
  sortOrder: number;
};

type DailyTaskState = {
  date: string;
  taskId: string;
  completedAt?: string;
};
```

Rules:

- Generate the day’s task instances based on local time zone.
- Preserve definitions across days.
- Reset completion state by date, not by deleting history.
- Support all-days and selected-weekdays schedules.
- Allow tasks to be completed through the UI or voice.
- Trigger celebration only when all enabled tasks marked `requiredForCelebration` are complete.
- Prevent duplicate celebration after reload.

Ambient presentation:

- Show a compact ring or `3 / 5`.
- Show at most three task names at one time.
- Do not show a dense checkbox list until interactive mode.

## 10.6 Presence detection

Use MediaPipe Face Detector for web.

Pipeline:

1. Request camera permission in settings, not unexpectedly at first boot.
2. Capture a low-resolution hidden video stream, approximately 320 × 180.
3. Run detection approximately once per second in ambient mode.
4. Use a rolling confidence window.
5. Enter awakening when a face is detected in 2 of the last 3 frames.
6. Remain visible for a minimum dwell time to prevent flicker.
7. Return to ambient after approximately 20–30 seconds with no face.
8. Enter sleep only after a longer absence period.

Performance/privacy:

- Never render the camera preview in normal UI.
- Never save frames.
- Never send frames over the network.
- Release the camera when presence detection is disabled.
- Provide mouse/keyboard activity as a fallback presence signal.
- Provide a manual wake shortcut if camera permission is denied.
- Log only state transitions, never images or biometric details.

## 10.7 Voice commands

P0 voice is **push-to-talk**, not always listening.

Why:

- It is more private.
- It avoids accidental activation.
- It is easier to make reliable.
- It does not require a wake-word engine.
- It is appropriate for a side project and public demo.

Flow:

1. Enter interactive mode.
2. Hold or press the voice orb/global shortcut.
3. Record a bounded utterance with `MediaRecorder`.
4. Send the completed audio to a transcription provider.
5. Parse the transcript locally into a supported command.
6. Display a glass confirmation.
7. Require confirmation for ambiguous or destructive actions.

Recommended optional transcription provider:

- OpenAI Audio Transcriptions using `gpt-4o-mini-transcribe`.
- Send audio from the Rust backend so the API key never enters frontend JavaScript.
- Delete audio bytes immediately after transcription.
- Do not record until the user explicitly activates the microphone.

Typed input must use the same command parser and remain available when voice is not configured.

Supported command grammar for the first release:

```text
Remind me tomorrow at 9 AM to call the dentist.
Add buy groceries to my tasks.
Mark buy groceries complete.
What is on my calendar today?
Show sports.
Show tasks.
Snooze for ten minutes.
Switch to rain mode.
Return to automatic mode.
```

Use deterministic intent parsing first. Use `chrono-node` or an equivalent library for date/time extraction. Do not introduce a general-purpose conversational agent until the command set is stable.

Future:

- Local Whisper sidecar.
- Realtime transcription.
- Wake word.
- Spoken responses.

## 10.8 Alarm

P0:

- Store alarms locally.
- Run a Rust scheduler while the app is active.
- Play a bundled audio file.
- Bring the app into `alarm` mode.
- Send a native Windows notification as a secondary channel.
- Support snooze and dismiss.
- Restore prior volume where feasible.
- Show a readiness warning in settings when Windows sleep may prevent firing.

Suggested alarm model:

```ts
type Alarm = {
  id: string;
  label: string;
  localTime: string;
  daysOfWeek: number[];
  enabled: boolean;
  soundId: string;
  snoozeMinutes: number;
};
```

Future P1 reliability:

- Windows Task Scheduler integration.
- Wake timers.
- Recovery after restart.
- Multiple audio-output fallback.

## 10.9 Celebration

Use an event-driven trigger:

```ts
type CelebrationEvent = {
  date: string;
  reason: "all-required-tasks-complete";
  playedAt: string;
};
```

Requirements:

- At most once per local date.
- Can be disabled.
- Respects reduced-motion preference.
- Does not interrupt an alarm or voice confirmation.
- Adapts to scene family.

---

# 11. Settings and onboarding

Settings should be hidden from the ambient composition and opened with `Ctrl+Shift+,`.

Onboarding steps:

1. Select display/monitor.
2. Confirm Wallpaper Engine executable.
3. Test each configured playlist.
4. Set location and time zone.
5. Enable/disable presence detection.
6. Configure absence and sleep timers.
7. Add repeating daily tasks.
8. Add alarms.
9. Set favorite sports leagues/teams.
10. Connect GitHub.
11. Optionally connect Google Calendar.
12. Optionally configure voice transcription.
13. Enable launch at startup.
14. Run a final “display readiness” test.

Settings health panel:

- Wallpaper Engine: connected/not found.
- Weather: current/stale.
- GitHub: connected/needs auth.
- Sports: provider tier and last refresh.
- Calendar: local only/Google connected.
- Camera: permission and detector status.
- Voice: typed only/transcription configured.
- Alarm: app-running guarantee and sleep warning.

No raw stack traces in the ambient UI.

---

# 12. Security and privacy

- Never commit API keys, OAuth tokens, refresh tokens, or personal calendar data.
- Provide `.env.example` containing names only.
- Use Tauri Stronghold or a Windows-native secure credential abstraction.
- Keep provider calls in Rust where practical.
- Redact authorization headers and secrets from logs.
- Validate all Wallpaper Engine paths and playlist names.
- Use minimal Tauri capabilities.
- Do not expose unrestricted shell execution to the frontend.
- Process webcam frames locally and ephemerally.
- Record microphone audio only during explicit push-to-talk.
- Add a visible microphone-listening state.
- Delete temporary audio after transcription.
- Provide one-click disconnect/revoke actions for integrations.
- Do not include private event names, repository names, or task data in telemetry. The initial app should have no telemetry.

---

# 13. Offline and failure behavior

| Failure | Ambient behavior |
|---|---|
| Weather unavailable | Use cached weather; otherwise fallback scene and time only. |
| Wallpaper Engine unavailable | Render a calm internal gradient/preview background and expose setup status only in settings. |
| GitHub unavailable | Retain last value with a stale timestamp in settings; hide module if no cache. |
| Sports unavailable | Hide ribbon. |
| Google disconnected | Continue with local calendar/reminders. |
| Camera denied | Wake through shortcut or input activity. |
| Voice unavailable | Use typed command input. |
| Alarm audio fails | Enter alarm view and send native notification. |
| No network | Continue time, local tasks, local alarms, cached calendar, cached weather, and cached sports. |

Errors must never cause layout shifts that make the composition look broken.

---

# 14. Performance budgets

The Dell is thermally constrained, so efficiency matters.

Targets, measured with Wallpaper Engine running:

- Presence detection: 1 FPS by default, low-resolution input.
- No full-screen continuously animated blur.
- Remote polling no more frequently than required.
- UI animations should primarily use transform and opacity.
- Pause or reduce nonessential animation in sleep state.
- No camera frame storage.
- No excessive React rerenders from a one-second clock.
- Keep provider data outside high-frequency animation state.
- Visual animation target: smooth on the device, ideally near display refresh rate.
- App idle CPU should be low enough that fan behavior is acceptable; measure rather than assume a fixed universal percentage.
- Add a performance debug overlay showing frame time, detection time, polling status, and state transitions.

Wallpaper choice can dominate GPU usage. Prefer efficient video/scene wallpapers and test each playlist on the XPS.

---

# 15. Accessibility and usability

- Respect `prefers-reduced-motion`.
- Provide a non-liquid fade variant for reduced motion.
- Maintain legible contrast over bright scenes.
- Never convey task status with color alone.
- Make settings keyboard accessible.
- Provide text labels for icons.
- Do not flash rapidly during storms or celebrations.
- Allow alarm audio and animation intensity to be configured.
- Provide a simple manual hide/exit shortcut that always works.

---

# 16. Implementation milestones

## Milestone 0 — Repository and verification harness

Deliver:

- React/TypeScript/Vite app.
- Tauri 2 shell.
- Formatting, linting, type checking, unit tests.
- Playwright preview mode.
- `AGENTS.md`.
- `PROGRESS.md`.
- `.env.example`.
- Mock providers.
- Deterministic demo-state controls.

Exit criteria:

- Web preview launches.
- Tauri shell launches on the current platform.
- Test and build commands are documented and pass.

## Milestone 1 — Visual hero shell

Deliver:

- Transparent production layout.
- Preview background.
- Hero clock.
- Weather capsule.
- Primary rotating island.
- Sports ribbon.
- Glass component primitives.
- Liquid reveal and dismissal.
- Responsive 16:10 layout.

Exit criteria:

- A deterministic 1920 × 1200 screenshot exists.
- UI closely follows `design/reference/glance.png`.
- No visible dashboard grid or browser chrome.
- Animation is smooth in browser preview.

**This is the first LinkedIn-ready checkpoint.**

## Milestone 2 — Display state machine

Deliver:

- All display modes.
- Timers and transitions.
- Pointer-event toggling.
- Global shortcuts.
- Demo-mode state forcing.
- Black sleep cover.
- Alarm and celebration shells.

Exit criteria:

- Automated tests cover key transitions.
- No flicker from repeated presence state changes.
- Overlay can always be hidden/recovered.

## Milestone 3 — Weather and Wallpaper Engine

Deliver:

- Open-Meteo provider.
- Day-part calculation.
- WMO normalization.
- Scene mapping and hysteresis.
- Wallpaper Engine executable detection and secure command invocation.
- Settings test controls.
- Internal fallback scene.

Exit criteria:

- Simulated weather selects the expected playlist.
- Live weather updates UI.
- Duplicate scene commands are suppressed.
- Non-Windows development uses a mock adapter.

## Milestone 4 — Local utility layer

Deliver:

- Local calendar/reminders.
- Repeating tasks.
- Daily reset logic.
- Celebration trigger.
- Alarm scheduler.
- Native notifications.
- Persistent non-secret settings.

Exit criteria:

- Tasks survive restart.
- New date creates new completion state.
- Celebration fires once.
- Local reminder and alarm can be tested through accelerated demo time.

## Milestone 5 — Presence

Deliver:

- Camera permission flow.
- MediaPipe face/no-face detection.
- Rolling confidence logic.
- Presence state integration.
- Privacy explanation.
- Performance controls.

Exit criteria:

- No frame leaves the process.
- Approach reveals the UI.
- Leaving dismisses it after the configured timeout.
- Input-activity fallback works.

## Milestone 6 — External providers

Deliver:

- GitHub GraphQL adapter.
- Sports provider adapter.
- Google Calendar OAuth adapter.
- Secure token storage.
- Cached and stale states.
- Provider health settings.

Exit criteria:

- App remains fully usable with every credential absent.
- Mock mode still supports deterministic tests.
- Real providers can be connected independently.

## Milestone 7 — Voice

Deliver:

- Push-to-talk orb.
- Typed command fallback.
- Audio capture.
- Optional OpenAI transcription adapter.
- Deterministic command parser.
- Confirmation UI.
- Calendar/task/alarm commands.

Exit criteria:

- Supported commands have parser tests.
- Ambiguous commands do not silently create incorrect events.
- API key is not present in frontend bundles or logs.
- Microphone is active only during explicit listening.

## Milestone 8 — Windows hardening and packaging

Deliver:

- Startup behavior.
- Monitor selection.
- Fullscreen/transparent/skip-taskbar validation.
- Installer.
- Logging and diagnostics.
- Settings backup/export excluding secrets.
- Manual Windows smoke checklist.

Exit criteria:

- Clean install on the Dell.
- Starts without white-window flash.
- Wallpaper Engine and overlay recover after restart.
- Global emergency hide shortcut works.
- All P0 acceptance criteria pass on Windows.

---

# 17. One-hour hero-demo sequence

When the goal is to see something beautiful as quickly as possible, use this order:

## Minute 0–10

- Scaffold Tauri + React.
- Add full-screen transparent window configuration.
- Add preview mode and fixed demo data.

## Minute 10–25

- Build the hero composition from the reference image.
- Add glass primitives, typography, spacing, and vignette.
- Ignore real integrations.

## Minute 25–40

- Add the Liquid Glass reveal/dismiss animation.
- Add deterministic controls for presence, alarm, and celebration.
- Capture the first screenshot.

## Minute 40–50

- Add live weather.
- Normalize weather and time into scene keys.
- Expose selected scene in debug mode.

## Minute 50–60

- Invoke Wallpaper Engine’s named playlist command.
- Run the visual composition over a real selected wallpaper.
- Record a short approach/reveal demo or use simulated presence.

Anything beyond this is follow-on work, even if Codex continues autonomously.

---

# 18. Verification strategy

## 18.1 Required scripts

Create a single verification command:

```text
npm run verify
```

It should run, at minimum:

- Formatting check.
- Lint.
- Type check.
- Unit tests.
- Frontend production build.
- Playwright deterministic preview tests.

Add a Tauri verification command appropriate to the current platform. On Windows, include a Tauri build or compile check.

## 18.2 Unit tests

Test:

- WMO code normalization.
- Sunrise/sunset day-part boundaries.
- Time-zone and DST daily reset.
- Scene hysteresis.
- Duplicate playlist suppression.
- Display state transitions.
- Presence rolling window.
- Task completion and single celebration.
- Alarm scheduling calculations.
- Voice command parsing.
- Sports sorting.
- Calendar day filtering.
- Provider stale-cache behavior.

## 18.3 Visual tests

Capture at least:

- Clear morning glance.
- Rainy night glance.
- Ambient/no UI.
- Mid-reveal frame or animation test.
- Alarm.
- Celebration.
- Settings.
- Offline fallback.

Use a deterministic test background. Store captures in:

```text
artifacts/screenshots/
```

Compare the final glance screen against the supplied reference at the same aspect ratio. Pixel-perfect automated comparison may not be meaningful for an artistic mock, so combine screenshot artifacts with an explicit visual checklist:

- Layout hierarchy matches.
- Glass opacity and edges match.
- Typography scale matches.
- Spacing matches.
- Wallpaper remains dominant.
- No module appears like a generic dashboard card.
- No text overlaps at 1920 × 1200 or the native XPS resolution.
- Sports movement is readable.
- Reveal feels cohesive rather than like independent cards popping in.

## 18.4 Windows manual smoke test

Run on the Dell:

1. Launch Wallpaper Engine.
2. Launch Ambient Glass.
3. Confirm no taskbar entry or title bar.
4. Confirm desktop wallpaper remains visible through transparent regions.
5. Test every playlist from settings.
6. Test clear/rain/day/night scene switching.
7. Grant camera permission and test presence.
8. Test pointer click-through and interactive mode.
9. Test emergency hide shortcut.
10. Test local task persistence.
11. Test celebration.
12. Test local reminder and alarm.
13. Connect each external integration independently.
14. Restart Windows and test startup.
15. Observe CPU/GPU/fan behavior for at least 20 minutes.
16. Disconnect network and confirm graceful fallback.

Do not claim Windows-specific behavior is verified if the implementation was only tested on macOS or in a browser.

---

# 19. P0 acceptance criteria

The build is P0-complete only when all applicable items are checked:

## Visual

- [ ] `design/reference/glance.png` is represented closely at the target aspect ratio.
- [ ] Wallpaper Engine remains the dominant visual element.
- [ ] Overlay is transparent outside the intended glass surfaces.
- [ ] Liquid reveal and dismissal are polished and reversible.
- [ ] No generic grid dashboard is visible.
- [ ] Text is readable over bright and dark scenes.
- [ ] Layout works at 1920 × 1200 and the laptop’s native resolution.
- [ ] Reduced-motion mode works.

## Automatic behavior

- [ ] Time and weather select a scene key.
- [ ] Scene key maps to a configurable Wallpaper Engine playlist.
- [ ] Playlist changes are debounced and not duplicated.
- [ ] Presence can reveal and dismiss the overlay.
- [ ] Long absence can enter optional sleep.
- [ ] The display recovers from sleep or hidden state.

## Features

- [ ] Weather is real and cached.
- [ ] GitHub commits/contributions are correctly labeled.
- [ ] Sports are normalized into one ribbon.
- [ ] Today’s calendar items display.
- [ ] Local reminders can be created.
- [ ] Daily repeating tasks persist and reset correctly.
- [ ] Celebration triggers once after required tasks complete.
- [ ] Alarm works while the app and computer remain active.
- [ ] Push-to-talk or typed commands can create a reminder and update a task.

## Robustness

- [ ] App runs attractively without any external credentials.
- [ ] No secret is committed or exposed to the webview.
- [ ] Camera frames remain local and ephemeral.
- [ ] Missing providers do not break layout.
- [ ] `npm run verify` passes.
- [ ] Windows smoke checklist is completed on the Dell.
- [ ] README documents setup, limitations, and manual configuration.

---

# 20. P1 ideas after the core build

- Wake word with an explicit privacy toggle.
- Local Whisper transcription.
- Windows Task Scheduler wake alarms.
- Native per-panel acrylic windows.
- True refraction via desktop capture and GPU shader.
- Ambient audio tied to weather.
- Spotify now-playing capsule.
- Indoor temperature/air-quality sensor.
- Home Assistant connection.
- Package tracking.
- Adaptive glass highlight using face position.
- Morning spoken briefing.
- Multiple visual themes.
- Phone-based remote settings.
- A curated Wallpaper Engine collection with creator credits.
- A “record demo” mode that automatically runs through the best states.

---

# 21. Physical presentation

The software will look more intentional if the hardware presentation is clean:

- Use a low, dark laptop stand or a floating shelf.
- Route the charging cable behind the stand.
- Disable keyboard backlighting.
- Hide desktop icons and the Windows taskbar.
- Consider a reversible matte-black keyboard-deck cover that does not block ventilation or the power button.
- Keep the screen nearly upright so the keyboard is less prominent from across the room.
- Do not block the XPS intake or exhaust vents.
- Use a conservative Windows power profile to reduce thermal noise.

---

# 22. Manual inputs required from the user

Codex can build around missing credentials, but these inputs eventually require the user:

- The final UI reference image.
- The actual display resolution.
- Wallpaper Engine executable path if auto-detection fails.
- Playlist names and selected wallpapers.
- Location and time zone.
- GitHub username and token.
- Favorite sports leagues/team IDs.
- Google OAuth client configuration.
- Optional OpenAI API key for speech transcription.
- Daily task definitions.
- Alarm times and sound choice.

None of these should be hard-coded into source control.

---

# 23. Reference documentation

Use the current official documentation while implementing:

- Wallpaper Engine command-line controls:  
  https://help.wallpaperengine.io/en/functionality/cli.html
- Wallpaper Engine automatic startup:  
  https://help.wallpaperengine.io/en/functionality/automaticstartup.html
- Tauri window customization:  
  https://v2.tauri.app/learn/window-customization/
- Tauri configuration and window effects:  
  https://v2.tauri.app/reference/config/
- Tauri plugins:  
  https://v2.tauri.app/plugin/
- MediaPipe Face Detector for Web:  
  https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js
- Open-Meteo forecast API:  
  https://open-meteo.com/en/docs
- GitHub GraphQL user/contribution fields:  
  https://docs.github.com/en/graphql/reference/users
- GitHub GraphQL authentication and calls:  
  https://docs.github.com/en/graphql/guides/forming-calls-with-graphql
- Google Calendar JavaScript quickstart:  
  https://developers.google.com/workspace/calendar/api/quickstart/js
- Google Calendar event creation:  
  https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- TheSportsDB API guide:  
  https://www.thesportsdb.com/docs_api_guide
- OpenAI speech-to-text guide:  
  https://developers.openai.com/api/docs/guides/speech-to-text

---

# 24. Final product statement

Ambient Glass is successful when the laptop no longer reads as “an old computer showing widgets.” It should read as a living environmental display that happens to know the time, the weather, what matters today, and when the user has walked into the room.

When there is a conflict between adding another integration and making the composition quieter, more coherent, or more beautiful, choose beauty.
