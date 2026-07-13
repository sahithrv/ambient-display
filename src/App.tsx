import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AmbientDisplay,
  GoogleCalendarSetup,
  LocalRoutineSetup,
  WallpaperSetup,
  type AlarmDisplayData,
  type CalendarDayDisplay,
  type ScoreDisplay,
  type TaskDisplay,
  type WeatherCondition,
  type WeatherDisplayData,
} from "./components";
import {
  addCalendarDays,
  calendarWeekForDate,
  calendarEventsForDate,
  createEmptyLocalData,
  createTaskCompletionCelebration,
  dailyTaskInstances,
  derivePresenceAction,
  EMPTY_PRESENCE_STATE,
  dueScheduledAlarmOccurrences,
  dueDisplayEvent,
  dedupeCalendarEvents,
  evaluateSceneHysteresis,
  localDateKey,
  markSceneIssued,
  markTaskCompleted,
  markTaskIncomplete,
  modeAllowsPointerEvents,
  nextScheduledDisplayEvent,
  nextScheduledAlarmOccurrence,
  normalizeWmoCode,
  parseTypedCommand,
  recordInputActivity,
  recordPresenceSample,
  remindersForDate,
  resolveSceneLock,
  selectWeatherScene,
  snoozeUntil,
  sortSportsEvents,
  transitionDisplay,
  zonedDateTimeToEpoch,
  type AmbientCommand,
  type Alarm,
  type CalendarEvent,
  type DisplayEvent,
  type DisplayMode,
  type DisplayState,
  type LocalData,
  type SceneHysteresisState,
  type SceneKey,
  type SceneLock,
  type ScheduledAlarmOccurrence,
  type SportsEvent,
  type ProviderStatus,
  type Reminder,
  type WeatherSnapshot,
} from "./domain";
import {
  MediaPipePresenceController,
  type CameraPresenceSnapshot,
} from "./features/presence/mediaPipePresence";
import {
  PushToTalkRecorder,
  transcribeExplicitRecording,
  type VoiceState,
} from "./features/voice/voiceRecorder";
import { loadLocalData, saveLocalData } from "./services/localStore";
import {
  GitHubDesktopProvider,
  GoogleCalendarDesktopProvider,
  readCachedGithubToday,
  readCachedSportsEvents,
  SportsDesktopProvider,
} from "./services/desktopProviders";
import {
  previewAlarm,
  previewEvents,
  previewSports,
  previewTasks,
  previewWeather,
} from "./services/mockData";
import { loadNativeLocalData, saveNativeLocalData } from "./services/nativeSettingsStore";
import {
  BROWSER_SHORTCUT_EVENT,
  consumePendingBrowserShortcut,
  pendingBrowserShortcut,
} from "./services/browserShortcuts";
import {
  deleteProviderSecret,
  dismissNativeAlarm,
  getAutostartEnabled,
  listNativeAlarms,
  listenForNativeAlarms,
  nativeAlarmSchedulerStatus,
  requestNativeNotificationPermission,
  saveProviderSecret,
  scheduleNativeAlarm,
  secureStorageStatus,
  sendAlarmNotification,
  setAutostartEnabled,
  snoozeNativeAlarm,
  testNativeAlarm,
  type NativeAlarmSchedulerStatus,
  type ProviderSecretSlot,
  type SecureStorageStatus,
} from "./services/nativeRuntime";
import {
  applyWallpaperScene,
  closeInAppWallpaper,
  getWallpaperEngineStatus,
  invokeTauri,
  isTauriRuntime,
  listenForNativeShortcuts,
  quitNativeApplication,
  setNativeWindowMode,
  type NativeShortcutAction,
  type NativeShortcutEvent,
  type WallpaperEngineStatus,
  type WallpaperSceneResult,
} from "./services/tauri";
import { OpenMeteoWeatherProvider } from "./services/weatherProvider";
import type { WallpaperFallbackState, WeatherLocation } from "./services/types";

type PreviewMode = Exclude<DisplayMode, "booting" | "awakening" | "sleep">;

/** Native supplies visibility; browser preview derives it from the current mode. */
type ShortcutIntent = NativeShortcutEvent;

interface SceneAttempt {
  scene: SceneKey;
  retryCount: number;
  inFlight: boolean;
  retryScheduled: boolean;
}

const WALLPAPER_RETRY_DELAYS_MS = [1_000, 3_000, 10_000] as const;
const BUNDLED_ALARM_CHIME_URL = `${import.meta.env.BASE_URL}audio/alarm-default.wav`;

type AlarmTriggerSource = "scheduled" | "snooze";

interface ActiveAlarm extends ScheduledAlarmOccurrence {
  source: AlarmTriggerSource;
  /** True only for an event controlled by the native app-active scheduler. */
  native?: boolean;
}

interface SnoozedAlarm {
  alarmId: string;
  dueAt: number;
}

interface PreviewConfig {
  preview: boolean;
  mode?: DisplayMode;
  weather?: WeatherCondition;
  presence: boolean;
  frozenNow?: Date;
  offline: boolean;
  debug: boolean;
  reducedMotion: boolean;
}

const MODE_VALUES: readonly DisplayMode[] = [
  "booting",
  "sleep",
  "ambient",
  "awakening",
  "glance",
  "interactive",
  "alarm",
  "celebration",
  "settings",
];

/** Recover a short suspended/background interval without replaying old alarms. */
const ACTIVE_APP_ALARM_RECOVERY_WINDOW_MS = 15 * 60_000;

const PREVIEW_CONFIG = readPreviewConfig();

export default function App() {
  const [clockNow, setClockNow] = useState(() => PREVIEW_CONFIG.frozenNow ?? new Date());
  const [display, setDisplay] = useState<DisplayState>(() => createInitialDisplay(PREVIEW_CONFIG));
  const displayRef = useRef(display);
  const [initialProviderData] = useState(() => createInitialProviderData(clockNow));
  const [localData, setLocalData] = useState<LocalData>(() =>
    initialLocalData(clockNow, PREVIEW_CONFIG.preview),
  );
  const [debugOpen, setDebugOpen] = useState(PREVIEW_CONFIG.debug);
  const [debugWeather, setDebugWeather] = useState<WeatherCondition | undefined>(
    PREVIEW_CONFIG.weather,
  );
  const [previewPresence, setPreviewPresence] = useState(PREVIEW_CONFIG.presence);
  const [commandInput, setCommandInput] = useState("");
  const [commandMessage, setCommandMessage] = useState("Type a command or use push-to-talk.");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [cameraStatus, setCameraStatus] = useState<CameraPresenceSnapshot>({
    state: "disabled",
    message: `Camera is off. ${inputWakeFallbackMessage()}`,
  });
  const [weatherSnapshot, setWeatherSnapshot] = useState<WeatherSnapshot>(() =>
    PREVIEW_CONFIG.preview ? previewWeather : createUnavailableWeatherSnapshot(),
  );
  const [weatherStatus, setWeatherStatus] = useState<ProviderStatus>({
    state: PREVIEW_CONFIG.offline ? "offline" : "stale",
    message: PREVIEW_CONFIG.offline ? "Offline preview" : "Set a location for live weather",
  });
  const [location, setLocation] = useState<WeatherLocation | null>(() => loadLocation());
  const [nativeStoreReady, setNativeStoreReady] = useState(!isTauriRuntime());
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [secureStatus, setSecureStatus] = useState<SecureStorageStatus | null>(null);
  // Fixtures are exclusive to ?preview=1. A regular launch begins with only
  // same-day stale cached data, if any, and never relabels demo data as live.
  const [githubToday, setGithubToday] = useState<number | null>(
    () => initialProviderData.githubToday,
  );
  const [githubProviderStatus, setGithubProviderStatus] = useState<ProviderStatus>(
    () => initialProviderData.githubStatus,
  );
  const [sportsEvents, setSportsEvents] = useState(() => initialProviderData.sportsEvents);
  const [sportsProviderStatus, setSportsProviderStatus] = useState<ProviderStatus>(
    () => initialProviderData.sportsStatus,
  );
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarProviderStatus, setCalendarProviderStatus] = useState<ProviderStatus>({
    state: "needs-auth",
    message: "Using local calendar",
  });
  const [sceneLock, setSceneLock] = useState<SceneLock>({ mode: "automatic" });
  const [sceneKey, setSceneKey] = useState<SceneKey>("fallback.any");
  const [sceneMessage, setSceneMessage] = useState("Scene selection is preparing.");
  const [wallpaperStatus, setWallpaperStatus] = useState<ProviderStatus>(initialWallpaperStatus);
  const [wallpaperFallback, setWallpaperFallback] = useState<WallpaperFallbackState>({
    active: false,
    mode: "automatic",
  });
  const [nativeWallpaperStatus, setNativeWallpaperStatus] = useState<WallpaperEngineStatus | null>(
    null,
  );
  const [wallpaperHostReady, setWallpaperHostReady] = useState(false);
  const [nativeAlarmStatus, setNativeAlarmStatus] = useState<NativeAlarmSchedulerStatus | null>(
    null,
  );
  const [activeAlarm, setActiveAlarm] = useState<ActiveAlarm | null>(null);

  const presenceStateRef = useRef({
    samples: [] as ReturnType<typeof recordPresenceSample>["samples"],
  });
  const sceneStateRef = useRef<SceneHysteresisState>({});
  const attemptedSceneRef = useRef<SceneAttempt | undefined>(undefined);
  const desiredSceneRef = useRef<SceneKey | undefined>(undefined);
  const sceneRetryTimerRef = useRef<number | undefined>(undefined);
  const firedAlarmsRef = useRef(new Set<string>());
  const activeAlarmRef = useRef<ActiveAlarm | null>(null);
  const snoozedAlarmsRef = useRef(new Map<string, SnoozedAlarm>());
  const pendingAlarmsRef = useRef<ActiveAlarm[]>([]);
  const lastAlarmCheckRef = useRef<number | undefined>(undefined);
  const alarmToneRef = useRef<AlarmToneController | undefined>(undefined);
  const previousDisplayModeRef = useRef(display.mode);
  const firedRemindersRef = useRef(new Set<string>());
  const cameraControllerRef = useRef<MediaPipePresenceController | undefined>(undefined);
  const recorderRef = useRef<PushToTalkRecorder | undefined>(undefined);
  const githubProviderRef = useRef<GitHubDesktopProvider | undefined>(undefined);
  const sportsProviderRef = useRef<SportsDesktopProvider | undefined>(undefined);
  const googleCalendarProviderRef = useRef<GoogleCalendarDesktopProvider | undefined>(undefined);
  const previewPresenceActivatedRef = useRef(PREVIEW_CONFIG.presence);
  const nativeOverlayReadyRef = useRef(false);
  const nativeWindowQueueRef = useRef(Promise.resolve());
  const nativeWindowRevisionRef = useRef(0);
  const wallpaperHostReadyRef = useRef(false);
  const [sceneRetryNonce, setSceneRetryNonce] = useState(0);

  const effectiveNow = PREVIEW_CONFIG.frozenNow ?? clockNow;
  const dateKey = localDateKey(effectiveNow) ?? "2026-05-11";
  const weatherForDisplay = useMemo(
    () => applyPreviewWeather(weatherSnapshot, debugWeather),
    [weatherSnapshot, debugWeather],
  );
  const weatherFamily = normalizeWmoCode(weatherForDisplay.weatherCode);
  const sceneMinute = Math.floor(effectiveNow.getTime() / 60_000);
  const automaticScene = useMemo(
    () => selectWeatherScene(weatherForDisplay, new Date(sceneMinute * 60_000)),
    [sceneMinute, weatherForDisplay],
  );

  const dispatchDisplay = useCallback((event: DisplayEvent) => {
    setDisplay((current) => transitionDisplay(current, event, Date.now()));
  }, []);

  const applyShortcut = useCallback((shortcut: ShortcutIntent) => {
    // Invalidate a queued React-native sync immediately: a native global
    // shortcut has already applied its window operation before this callback.
    nativeWindowRevisionRef.current += 1;
    const now = Date.now();
    setDisplay((current) => transitionForShortcut(current, shortcut, now));

    if (shortcut.action === "debug" && shortcut.visible) {
      setDebugOpen(true);
    } else if (shortcut.action === "settings" || !shortcut.visible) {
      setDebugOpen(false);
    }
  }, []);

  const applyBrowserShortcut = useCallback(
    (action: NativeShortcutAction) => {
      if (action !== "toggle") {
        applyShortcut({ action, visible: true });
        return;
      }

      const now = Date.now();
      nativeWindowRevisionRef.current += 1;
      // Ctrl+Shift+Space is the browser-preview equivalent of a real native
      // visibility toggle. It always clears the developer overlay as a hide
      // or fresh reveal should not carry an old debug surface forward.
      setDebugOpen(false);
      setDisplay((current) =>
        transitionForShortcut(
          current,
          { action, visible: browserToggleWillReveal(current.mode) },
          now,
        ),
      );
    },
    [applyShortcut],
  );

  const clearSceneRetryTimer = useCallback(() => {
    if (sceneRetryTimerRef.current !== undefined) {
      window.clearTimeout(sceneRetryTimerRef.current);
      sceneRetryTimerRef.current = undefined;
    }
  }, []);

  const refreshWallpaperHealth = useCallback(async () => {
    // Defer state synchronization so startup effects do not cause a cascading
    // render before the first painted frame.
    await Promise.resolve();
    if (PREVIEW_CONFIG.preview || !isTauriRuntime()) {
      setWallpaperStatus(previewWallpaperStatus());
      return;
    }

    setWallpaperStatus({ state: "loading", message: "Checking Wallpaper Engine availability…" });
    const result = await getWallpaperEngineStatus();
    if (result.ok) {
      setNativeWallpaperStatus(result.value);
      setWallpaperHostReady(result.value.inAppActive);
      setWallpaperStatus(wallpaperStatusFromNative(result.value));
      return;
    }
    setWallpaperStatus({ state: "error", message: result.message });
  }, []);

  const handleNativeWallpaperStatus = useCallback((status: WallpaperEngineStatus) => {
    setNativeWallpaperStatus(status);
    setWallpaperHostReady(status.inAppActive);
    setWallpaperStatus(wallpaperStatusFromNative(status));
  }, []);

  const handleWallpaperSceneTest = useCallback((_scene: SceneKey, result: WallpaperSceneResult) => {
    setSceneMessage(result.message);
    setWallpaperHostReady(result.inApp);
    setWallpaperStatus(wallpaperStatusFromOperation(result));
  }, []);

  const refreshNativeStatus = useCallback(() => {
    void secureStorageStatus().then(setSecureStatus);
    void getAutostartEnabled().then(setAutostart);
    void nativeAlarmSchedulerStatus().then((result) => {
      if (result.ok) {
        setNativeAlarmStatus(result.value);
      }
    });
  }, []);

  const applyPresenceAction = useCallback((detected: boolean, at = Date.now()) => {
    presenceStateRef.current = recordPresenceSample(presenceStateRef.current, detected, at);
    setDisplay((current) => transitionForPresence(current, at, presenceStateRef.current));
  }, []);

  const applyInputActivity = useCallback(() => {
    const now = Date.now();
    presenceStateRef.current = recordInputActivity(presenceStateRef.current, now);
    setDisplay((current) => {
      if (current.mode === "ambient" || current.mode === "sleep") {
        return transitionDisplay(current, { type: "MANUAL_WAKE" }, now);
      }
      return current;
    });
  }, []);

  const setPresenceEnabled = useCallback((enabled: boolean) => {
    if (!enabled) {
      cameraControllerRef.current?.stop();
      cameraControllerRef.current = undefined;
      // Do not let a recently detected face cause one more delayed wake after
      // the person has explicitly turned camera presence off. Browser input
      // and the Windows session-activity boundary can begin a fresh fallback
      // signal; Ctrl+Shift+Space remains the explicit recovery shortcut.
      presenceStateRef.current = { ...EMPTY_PRESENCE_STATE, samples: [] };
      setCameraStatus({
        state: "disabled",
        message: `Local camera presence is off. ${inputWakeFallbackMessage()}`,
      });
    }
    setLocalData((current) =>
      current.presenceEnabled === enabled ? current : { ...current, presenceEnabled: enabled },
    );
  }, []);

  const stopAlarmTone = useCallback(() => {
    alarmToneRef.current?.stop();
    alarmToneRef.current = undefined;
  }, []);

  const activateAlarm = useCallback(
    (trigger: ActiveAlarm) => {
      const current = activeAlarmRef.current;
      if (current?.occurrenceKey === trigger.occurrenceKey && current.source === trigger.source) {
        return;
      }

      activeAlarmRef.current = trigger;
      setActiveAlarm(trigger);
      stopAlarmTone();
      alarmToneRef.current = startRepeatingAlarmTone();
      dispatchDisplay({ type: "ALARM_TRIGGERED" });
      // Native scheduler events have already attempted the platform
      // notification. Browser-scheduled alarms retain the existing secondary
      // notification path.
      if (!trigger.native) {
        notifyAlarm(trigger.alarm.label);
      }
    },
    [dispatchDisplay, stopAlarmTone],
  );

  const enqueueAlarm = useCallback(
    (trigger: ActiveAlarm) => {
      const current = activeAlarmRef.current;
      if (!current) {
        activateAlarm(trigger);
        return;
      }
      if (current.occurrenceKey === trigger.occurrenceKey && current.source === trigger.source) {
        return;
      }

      const pending = pendingAlarmsRef.current;
      if (
        pending.some(
          (item) => item.occurrenceKey === trigger.occurrenceKey && item.source === trigger.source,
        )
      ) {
        return;
      }
      pending.push(trigger);
      pending.sort(compareAlarmTriggers);
    },
    [activateAlarm],
  );

  const dismissActiveAlarm = useCallback(() => {
    const current = activeAlarmRef.current;
    if (current?.native) {
      void dismissNativeAlarm(current.alarm.id).then((result) => {
        if (!result.ok) {
          setCommandMessage(result.message);
          return;
        }
        setNativeAlarmStatus(result.value.status);
        stopAlarmTone();
        activeAlarmRef.current = null;
        setActiveAlarm(null);
        const next = pendingAlarmsRef.current.shift();
        if (next) {
          activateAlarm(next);
        } else {
          dispatchDisplay({ type: "ALARM_DISMISSED" });
        }
      });
      return true;
    }
    stopAlarmTone();
    activeAlarmRef.current = null;
    setActiveAlarm(null);
    const next = pendingAlarmsRef.current.shift();
    if (next) {
      activateAlarm(next);
      return true;
    }
    dispatchDisplay({ type: "ALARM_DISMISSED" });
    return true;
  }, [activateAlarm, dispatchDisplay, stopAlarmTone]);

  const snoozeActiveAlarm = useCallback(
    (overrideMinutes?: number) => {
      const current = activeAlarmRef.current;
      if (!current) {
        return false;
      }

      if (current.native) {
        void snoozeNativeAlarm(
          current.alarm.id,
          overrideMinutes ?? current.alarm.snoozeMinutes,
        ).then((result) => {
          if (!result.ok) {
            setCommandMessage(result.message);
            return;
          }
          setNativeAlarmStatus(result.value.status);
          stopAlarmTone();
          activeAlarmRef.current = null;
          setActiveAlarm(null);
          const next = pendingAlarmsRef.current.shift();
          if (next) {
            activateAlarm(next);
          } else {
            dispatchDisplay({ type: "ALARM_SNOOZED" });
          }
        });
        return true;
      }

      const snooze = snoozeUntil(new Date(), overrideMinutes ?? current.alarm.snoozeMinutes);
      const dueAt = snooze ? Date.parse(snooze) : Number.NaN;
      if (!Number.isFinite(dueAt)) {
        return false;
      }

      snoozedAlarmsRef.current.set(current.alarm.id, { alarmId: current.alarm.id, dueAt });
      stopAlarmTone();
      activeAlarmRef.current = null;
      setActiveAlarm(null);
      const next = pendingAlarmsRef.current.shift();
      if (next) {
        activateAlarm(next);
      } else {
        dispatchDisplay({ type: "ALARM_SNOOZED" });
      }
      return true;
    },
    [activateAlarm, dispatchDisplay, stopAlarmTone],
  );

  useEffect(() => () => stopAlarmTone(), [stopAlarmTone]);

  useEffect(() => {
    const previousMode = previousDisplayModeRef.current;
    previousDisplayModeRef.current = display.mode;
    if (previousMode !== "alarm" || display.mode === "alarm") {
      return;
    }
    // A force-hide/debug transition may leave the alarm state without using
    // its buttons. Clear the alert instead of allowing audio to leak.
    stopAlarmTone();
    activeAlarmRef.current = null;
    pendingAlarmsRef.current = [];
    setActiveAlarm(null);
  }, [display.mode, stopAlarmTone]);

  useEffect(() => {
    displayRef.current = display;
    const mode = display.mode;
    const revision = ++nativeWindowRevisionRef.current;

    // Serialize window commands so a rapid React transition cannot arrive at
    // the native side out of order. A revision drops stale queued modes after
    // a newer transition. The initial show is deliberately a single queued
    // operation after the first rendered frame, not a side effect of every
    // non-boot display mode.
    nativeWindowQueueRef.current = nativeWindowQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (revision !== nativeWindowRevisionRef.current) {
          return;
        }
        await setNativeWindowMode(mode);
        if (revision === nativeWindowRevisionRef.current && !nativeOverlayReadyRef.current) {
          nativeOverlayReadyRef.current = true;
          await invokeTauri("mark_overlay_ready");
        }
      });
  }, [display]);

  useEffect(() => {
    let active = true;
    if (PREVIEW_CONFIG.preview) {
      void Promise.resolve().then(() => {
        if (active) {
          setNativeStoreReady(true);
        }
      });
    } else {
      void loadNativeLocalData().then((data) => {
        if (active && data) {
          setLocalData(withoutLegacyPreviewFixtures(data));
        }
        if (active) {
          setNativeStoreReady(true);
        }
      });
    }
    refreshNativeStatus();
    return () => {
      active = false;
    };
  }, [refreshNativeStatus]);

  useEffect(() => {
    const startHealthCheck = window.setTimeout(() => {
      void refreshWallpaperHealth();
    }, 0);
    return () => window.clearTimeout(startHealthCheck);
  }, [refreshWallpaperHealth]);

  useEffect(() => {
    wallpaperHostReadyRef.current = wallpaperHostReady;
  }, [wallpaperHostReady]);

  useEffect(() => {
    if (PREVIEW_CONFIG.preview || !isTauriRuntime() || wallpaperFallback.active) {
      return;
    }

    let active = true;
    const checkHost = async () => {
      const result = await getWallpaperEngineStatus();
      if (!active || !result.ok) {
        return;
      }
      const wasReady = wallpaperHostReadyRef.current;
      wallpaperHostReadyRef.current = result.value.inAppActive;
      setNativeWallpaperStatus(result.value);
      setWallpaperHostReady(result.value.inAppActive);
      if (wasReady && !result.value.inAppActive) {
        // Wallpaper Engine can be closed independently. Restore the internal
        // scene immediately, then let the normal bounded scene retry path
        // reopen the configured file without requiring an app restart.
        sceneStateRef.current = {
          ...sceneStateRef.current,
          lastIssuedSceneKey: undefined,
        };
        attemptedSceneRef.current = undefined;
        setWallpaperStatus({
          state: "stale",
          message: "The in-app wallpaper stopped. Reopening it…",
        });
        setSceneRetryNonce((current) => current + 1);
      }
    };

    const interval = window.setInterval(() => void checkHost(), 10_000);
    window.addEventListener("focus", checkHost);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkHost);
    };
  }, [wallpaperFallback.active]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForNativeAlarms((event) => {
      setNativeAlarmStatus((current) =>
        current
          ? {
              ...current,
              notification: event.notification,
              audio: event.audio,
              message: event.message,
            }
          : current,
      );
      if (event.kind !== "triggered" && event.kind !== "test") {
        return;
      }
      enqueueAlarm({
        alarm: event.active.alarm,
        occursAt: event.active.triggeredAtMs,
        occurrenceKey: event.active.occurrenceKey,
        source: event.active.source === "snooze" ? "snooze" : "scheduled",
        native: true,
      });
    }).then((stop) => {
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enqueueAlarm]);

  useEffect(() => {
    if (PREVIEW_CONFIG.preview || !isTauriRuntime() || !nativeStoreReady) {
      return;
    }

    let active = true;
    const syncNativeAlarms = async () => {
      const existing = await listNativeAlarms();
      if (!active || !existing.ok) {
        return;
      }
      setNativeAlarmStatus(existing.value.status);
      if (existing.value.active) {
        enqueueAlarm({
          alarm: existing.value.active.alarm,
          occursAt: existing.value.active.triggeredAtMs,
          occurrenceKey: existing.value.active.occurrenceKey,
          source: existing.value.active.source === "snooze" ? "snooze" : "scheduled",
          native: true,
        });
      }

      const configuredIds = new Set(localData.alarms.map((alarm) => alarm.id));
      const staleSchedules = existing.value.alarms
        .filter((alarm) => !configuredIds.has(alarm.id) && alarm.enabled)
        .map((alarm) => ({ ...alarm, enabled: false }));
      const schedules = [...localData.alarms, ...staleSchedules];
      for (const alarm of schedules) {
        const result = await scheduleNativeAlarm(alarm);
        if (!active) {
          return;
        }
        if (result.ok) {
          setNativeAlarmStatus(result.value.status);
        } else {
          setCommandMessage(result.message);
        }
      }
    };

    void syncNativeAlarms();
    return () => {
      active = false;
    };
  }, [enqueueAlarm, localData.alarms, nativeStoreReady]);

  useEffect(
    () => () => {
      clearSceneRetryTimer();
      attemptedSceneRef.current = undefined;
    },
    [clearSceneRetryTimer],
  );

  /**
   * Presence is an explicit, persisted privacy choice. Wait for Tauri Store
   * hydration before touching the camera so a stale browser fallback cannot
   * briefly request it on startup. The controller owns every stream and is
   * disposed both on opt-out and component teardown.
   */
  useEffect(() => {
    if (!nativeStoreReady) {
      return;
    }

    if (PREVIEW_CONFIG.preview) {
      cameraControllerRef.current?.stop();
      cameraControllerRef.current = undefined;
      const updateStatus = window.setTimeout(() => {
        setCameraStatus({
          state: "disabled",
          message: localData.presenceEnabled
            ? `Preview mode keeps the camera off. ${inputWakeFallbackMessage()}`
            : `Local camera presence is off. ${inputWakeFallbackMessage()}`,
        });
      }, 0);
      return () => window.clearTimeout(updateStatus);
    }

    if (!localData.presenceEnabled) {
      cameraControllerRef.current?.stop();
      cameraControllerRef.current = undefined;
      presenceStateRef.current = { ...EMPTY_PRESENCE_STATE, samples: [] };
      const updateStatus = window.setTimeout(() => {
        setCameraStatus({
          state: "disabled",
          message: `Local camera presence is off. ${inputWakeFallbackMessage()}`,
        });
      }, 0);
      return () => window.clearTimeout(updateStatus);
    }

    const controller = new MediaPipePresenceController();
    cameraControllerRef.current?.stop();
    cameraControllerRef.current = controller;
    void controller.start({
      onSample: applyPresenceAction,
      onStatus: (snapshot) => {
        // Permission prompts and model loading are asynchronous. Ignore an
        // old controller if the user disabled presence while either was open.
        if (cameraControllerRef.current === controller) {
          setCameraStatus(snapshot);
        }
      },
    });

    return () => {
      controller.stop();
      if (cameraControllerRef.current === controller) {
        cameraControllerRef.current = undefined;
      }
    };
  }, [applyPresenceAction, localData.presenceEnabled, nativeStoreReady]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduced-motion", PREVIEW_CONFIG.reducedMotion);
    return () => document.documentElement.classList.remove("reduced-motion");
  }, []);

  useEffect(() => {
    if (PREVIEW_CONFIG.frozenNow) {
      return;
    }

    // The UI displays minutes, not seconds. Updating the entire application
    // four times per second was needlessly repainting every glass surface and
    // is especially costly in a desktop WebView. Align updates to the next
    // minute so the clock remains exact without a constant render loop.
    let timer: number | undefined;
    const scheduleNextMinute = () => {
      const now = Date.now();
      const delay = 60_000 - (now % 60_000) + 16;
      timer = window.setTimeout(() => {
        setClockNow(new Date());
        scheduleNextMinute();
      }, delay);
    };
    scheduleNextMinute();
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    const scheduled = nextScheduledDisplayEvent(display);
    if (!scheduled) {
      return;
    }
    const delay = Math.max(0, scheduled.dueAt - Date.now());
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setDisplay((current) => {
        const due = dueDisplayEvent(current, now);
        return due ? transitionDisplay(current, due, now) : current;
      });
    }, delay + 16);
    return () => window.clearTimeout(timer);
  }, [display]);

  useEffect(() => {
    const recordInput = (event: Event) => {
      if (isDisplayShortcut(event) || isModifierOnlyKey(event)) {
        // The shortcut handler owns these combinations. Ignoring their generic
        // input sample prevents a local wake from racing a browser shortcut or
        // the native visibility result carried in a Tauri shortcut event.
        return;
      }
      applyInputActivity();
    };
    window.addEventListener("keydown", recordInput);
    window.addEventListener("pointerdown", recordInput);
    return () => {
      window.removeEventListener("keydown", recordInput);
      window.removeEventListener("pointerdown", recordInput);
    };
  }, [applyInputActivity]);

  useLayoutEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (displayRef.current.mode === "settings") {
          dispatchDisplay({ type: "CLOSE_SETTINGS" });
        } else if (debugOpen) {
          setDebugOpen(false);
        } else if (displayRef.current.mode === "interactive") {
          dispatchDisplay({ type: "INTERACTION_TIMEOUT" });
        }
        return;
      }
    };
    const browserShortcut = (event: Event) => {
      const action = (event as CustomEvent<unknown>).detail;
      if (
        action === "toggle" ||
        action === "interactive" ||
        action === "debug" ||
        action === "settings"
      ) {
        consumePendingBrowserShortcut();
        applyBrowserShortcut(action);
      }
    };
    const pendingShortcut = pendingBrowserShortcut();
    const pendingShortcutTimer = pendingShortcut
      ? window.setTimeout(() => {
          const action = consumePendingBrowserShortcut();
          if (action) {
            applyBrowserShortcut(action);
          }
        }, 0)
      : undefined;
    window.addEventListener("keydown", shortcuts);
    window.addEventListener(BROWSER_SHORTCUT_EVENT, browserShortcut);
    return () => {
      if (pendingShortcutTimer !== undefined) {
        window.clearTimeout(pendingShortcutTimer);
      }
      window.removeEventListener("keydown", shortcuts);
      window.removeEventListener(BROWSER_SHORTCUT_EVENT, browserShortcut);
    };
  }, [applyBrowserShortcut, debugOpen, dispatchDisplay]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForNativeShortcuts(applyShortcut).then((stop) => {
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyShortcut]);

  useEffect(() => {
    if (PREVIEW_CONFIG.preview) {
      return;
    }
    if (!location) {
      return;
    }
    const provider = new OpenMeteoWeatherProvider(location);
    let mounted = true;
    const refresh = async () => {
      const snapshot = await provider.refresh();
      if (!mounted) {
        return;
      }
      setWeatherStatus(provider.getStatus());
      if (snapshot) {
        setWeatherSnapshot(snapshot);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15 * 60 * 1_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [location]);

  useEffect(() => {
    if (PREVIEW_CONFIG.preview) {
      return;
    }
    let active = true;
    const provider = new GitHubDesktopProvider(dateKey);
    githubProviderRef.current = provider;
    void Promise.resolve().then(() => {
      if (!active) {
        return;
      }
      const cached = provider.getCached();
      setGithubToday(cached?.commits ?? null);
      setGithubProviderStatus(provider.getStatus());
    });
    if (!isTauriRuntime() || !secureStatus?.githubTokenConfigured) {
      return () => {
        active = false;
      };
    }
    const refresh = async () => {
      const result = await provider.refresh(dateKey);
      if (!active) {
        return;
      }
      setGithubProviderStatus(provider.getStatus());
      if (result) {
        setGithubToday(result.commits);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5 * 60 * 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [dateKey, secureStatus?.githubTokenConfigured]);

  useEffect(() => {
    if (PREVIEW_CONFIG.preview) {
      return;
    }
    let active = true;
    const provider = new SportsDesktopProvider(dateKey);
    sportsProviderRef.current = provider;
    void Promise.resolve().then(() => {
      if (!active) {
        return;
      }
      setSportsEvents(provider.getCached() ?? []);
      setSportsProviderStatus(provider.getStatus());
    });
    if (!isTauriRuntime() || !secureStatus?.sportsApiKeyConfigured) {
      return () => {
        active = false;
      };
    }
    const refresh = async () => {
      const result = await provider.refresh(dateKey);
      if (!active) {
        return;
      }
      setSportsProviderStatus(provider.getStatus());
      if (result) {
        setSportsEvents(result);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5 * 60 * 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [dateKey, secureStatus?.sportsApiKeyConfigured]);

  useEffect(() => {
    if (PREVIEW_CONFIG.preview) {
      return;
    }

    let active = true;
    const provider = new GoogleCalendarDesktopProvider(dateKey);
    googleCalendarProviderRef.current = provider;
    // Do not let an event from yesterday linger while the local-day boundary
    // changes or a connection has been removed. Google data stays in memory
    // only; local reminders remain independently persistent.
    void Promise.resolve().then(() => {
      if (active) {
        setGoogleCalendarEvents([]);
        setCalendarProviderStatus(provider.getStatus());
      }
    });

    if (!isTauriRuntime() || !secureStatus?.googleRefreshTokenConfigured) {
      return () => {
        active = false;
      };
    }

    const refresh = async () => {
      const events = await provider.refresh(dateKey);
      if (!active) {
        return;
      }
      setCalendarProviderStatus(provider.getStatus());
      if (events) {
        setGoogleCalendarEvents(events);
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 5 * 60 * 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [dateKey, secureStatus?.googleRefreshTokenConfigured]);

  useEffect(() => {
    const decision = evaluateSceneHysteresis(sceneStateRef.current, automaticScene, Date.now());
    sceneStateRef.current = decision.state;
    const desired = resolveSceneLock(sceneLock, decision.sceneKey);
    desiredSceneRef.current = desired;
    setSceneKey(desired);

    // A weather/lock change invalidates both a queued retry and its stale
    // completion callback. The new desired scene gets a fresh bounded budget.
    if (attemptedSceneRef.current && attemptedSceneRef.current.scene !== desired) {
      clearSceneRetryTimer();
      attemptedSceneRef.current = undefined;
    }

    if (PREVIEW_CONFIG.preview || !isTauriRuntime()) {
      clearSceneRetryTimer();
      attemptedSceneRef.current = undefined;
      sceneStateRef.current = markSceneIssued(sceneStateRef.current, desired);
      setSceneMessage(`Preview scene: ${friendlySceneName(desired)}.`);
      return;
    }

    if (wallpaperFallback.active) {
      clearSceneRetryTimer();
      attemptedSceneRef.current = undefined;
      setSceneMessage(wallpaperFallback.reason ?? "Using the internal fallback scene.");
      return;
    }

    if (desired === sceneStateRef.current.lastIssuedSceneKey) {
      clearSceneRetryTimer();
      attemptedSceneRef.current = undefined;
      return;
    }

    const pending = attemptedSceneRef.current;
    if (pending?.scene === desired && (pending.inFlight || pending.retryScheduled)) {
      return;
    }

    const attempt: SceneAttempt = {
      scene: desired,
      retryCount: pending?.scene === desired ? pending.retryCount : 0,
      inFlight: true,
      retryScheduled: false,
    };
    attemptedSceneRef.current = attempt;
    setWallpaperStatus({
      state: "loading",
      message: `Applying ${friendlySceneName(desired)} scene…`,
    });

    void applyWallpaperScene(desired).then((result) => {
      // A newer desired scene owns the health surface. Ignore any late result
      // from an in-flight request that was invalidated above.
      if (attemptedSceneRef.current !== attempt || desiredSceneRef.current !== desired) {
        return;
      }

      if (result.applied || result.duplicate) {
        clearSceneRetryTimer();
        attemptedSceneRef.current = undefined;
        sceneStateRef.current = markSceneIssued(sceneStateRef.current, desired);
        setWallpaperStatus(wallpaperStatusFromOperation(result));
        setWallpaperHostReady(result.inApp);
        setSceneMessage(result.message);
        return;
      }

      const delayMs = wallpaperRetryDelay(attempt.retryCount);
      if (delayMs === undefined) {
        attemptedSceneRef.current = undefined;
        const message = `${result.message} Automatic scene retries are exhausted.`;
        setWallpaperStatus({ state: "error", message });
        setSceneMessage(message);
        return;
      }

      attempt.inFlight = false;
      attempt.retryScheduled = true;
      attempt.retryCount += 1;
      setWallpaperStatus({
        state: "stale",
        message: `${result.message} Retrying in ${formatRetryDelay(delayMs)}.`,
      });
      setSceneMessage(`${result.message} Retrying in ${formatRetryDelay(delayMs)}.`);
      clearSceneRetryTimer();
      const retryCount = attempt.retryCount;
      sceneRetryTimerRef.current = window.setTimeout(() => {
        sceneRetryTimerRef.current = undefined;
        if (
          attemptedSceneRef.current === attempt &&
          desiredSceneRef.current === desired &&
          attempt.retryScheduled &&
          attempt.retryCount === retryCount
        ) {
          attempt.retryScheduled = false;
          setSceneRetryNonce((current) => current + 1);
        }
      }, delayMs);
    });
  }, [
    automaticScene,
    clearSceneRetryTimer,
    sceneLock,
    sceneRetryNonce,
    wallpaperFallback.active,
    wallpaperFallback.reason,
  ]);

  useEffect(() => {
    if (!wallpaperFallback.active || !isTauriRuntime()) {
      return;
    }
    void closeInAppWallpaper();
  }, [wallpaperFallback.active]);

  useEffect(() => {
    saveLocalData(localData, PREVIEW_CONFIG.preview ? "preview" : "production");
    if (nativeStoreReady && !PREVIEW_CONFIG.preview) {
      void saveNativeLocalData(localData);
    }
  }, [localData, nativeStoreReady]);

  useEffect(() => {
    // Tauri owns active-app scheduling through the native scheduler. Keep the
    // interval as the browser/preview fallback only; running both would create
    // duplicate alarms for the same local occurrence.
    if (!PREVIEW_CONFIG.preview && isTauriRuntime()) {
      return;
    }

    const checkAlarms = () => {
      const now = Date.now();
      const lastCheckedAt = lastAlarmCheckRef.current ?? now;
      lastAlarmCheckRef.current = now;
      const fromInclusive =
        lastCheckedAt <= now
          ? Math.max(lastCheckedAt, now - ACTIVE_APP_ALARM_RECOVERY_WINDOW_MS)
          : now;
      const due = dueScheduledAlarmOccurrences(
        localData.alarms,
        fromInclusive,
        now,
        firedAlarmsRef.current,
      ).map<ActiveAlarm>((occurrence) => ({ ...occurrence, source: "scheduled" }));

      for (const occurrence of due) {
        firedAlarmsRef.current.add(occurrence.occurrenceKey);
      }

      for (const snoozed of snoozedAlarmsRef.current.values()) {
        const alarm = localData.alarms.find((item) => item.id === snoozed.alarmId);
        if (!alarm?.enabled) {
          // Turning an alarm off also cancels its pending snooze.
          snoozedAlarmsRef.current.delete(snoozed.alarmId);
        } else if (snoozed.dueAt <= now) {
          snoozedAlarmsRef.current.delete(snoozed.alarmId);
          if (snoozed.dueAt >= now - ACTIVE_APP_ALARM_RECOVERY_WINDOW_MS) {
            due.push(createSnoozedAlarmTrigger(alarm, snoozed.dueAt));
          }
        }
      }

      due.sort(compareAlarmTriggers);
      due.forEach(enqueueAlarm);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkAlarms();
      }
    };

    checkAlarms();
    const interval = window.setInterval(checkAlarms, 5_000);
    window.addEventListener("focus", checkAlarms);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkAlarms);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enqueueAlarm, localData.alarms]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      for (const reminder of remindersForDate(localData.reminders, dateKey)) {
        if (reminder.allDay) {
          continue;
        }
        const start = new Date(reminder.startsAt);
        if (Number.isNaN(start.getTime())) {
          continue;
        }
        const localTime = `${String(start.getHours()).padStart(2, "0")}:${String(
          start.getMinutes(),
        ).padStart(2, "0")}`;
        const dueAt = zonedDateTimeToEpoch(dateKey, localTime);
        if (dueAt === undefined) {
          continue;
        }
        for (const offsetMinutes of reminder.notificationOffsetsMinutes) {
          const notifyAt = dueAt - offsetMinutes * 60_000;
          const key = `${reminder.id}:${dateKey}:${offsetMinutes}`;
          if (firedRemindersRef.current.has(key) || now < notifyAt || now - notifyAt > 75_000) {
            continue;
          }
          firedRemindersRef.current.add(key);
          notifyReminder(reminder.title);
        }
      }
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [dateKey, localData.reminders]);

  useEffect(() => {
    if (!PREVIEW_CONFIG.preview) {
      return;
    }
    if (previewPresence) {
      previewPresenceActivatedRef.current = true;
      applyPresenceAction(true, Date.now() - 1_000);
      applyPresenceAction(true, Date.now());
    } else if (previewPresenceActivatedRef.current) {
      // An initially absent preview is already in its requested passive mode.
      // Do not let that first synthetic absence race and undo a recovery
      // shortcut pressed while React is finishing its initial mount.
      applyPresenceAction(false, Date.now());
    }
  }, [applyPresenceAction, previewPresence]);

  useEffect(
    () => () => {
      cameraControllerRef.current?.stop();
      recorderRef.current?.cancel();
    },
    [],
  );

  const taskInstances = useMemo(
    () => dailyTaskInstances(localData.tasks, localData.taskStates, dateKey),
    [dateKey, localData.taskStates, localData.tasks],
  );
  const taskDisplays = useMemo<TaskDisplay[]>(
    () =>
      taskInstances.map((instance) => ({
        id: instance.task.id,
        title: instance.task.title,
        completed: Boolean(instance.completedAt),
        required: instance.task.requiredForCelebration,
        time: instance.task.preferredTime ? formatTaskTime(instance.task.preferredTime) : undefined,
      })),
    [taskInstances],
  );
  const calendarEvents = useMemo(
    () =>
      calendarEventsForDate(
        dedupeCalendarEvents([
          ...remindersForDate(localData.reminders, dateKey).map((reminder) =>
            calendarEventForLocalDate(reminder, dateKey),
          ),
          ...googleCalendarEvents,
        ]),
        dateKey,
      ),
    [dateKey, googleCalendarEvents, localData.reminders],
  );
  const calendarCard = useMemo(() => calendarCardForDate(dateKey), [dateKey]);
  const event = calendarEvents[0] ?? (PREVIEW_CONFIG.preview ? previewEvents[0] : undefined);
  const scoreDisplays = useMemo<ScoreDisplay[]>(
    () =>
      (PREVIEW_CONFIG.offline ? [] : sortSportsEvents(sportsEvents)).map((sport) => ({
        id: sport.id,
        league: sport.league,
        sport: sport.sport,
        status: sport.clockOrPeriod ?? sport.status,
        state: sport.status === "live" ? "live" : sport.status === "final" ? "final" : "scheduled",
        away: {
          name: sport.awayName,
          shortName: sport.awayName.slice(0, 3).toUpperCase(),
          score: sport.awayScore,
          mark: sport.awayName.slice(0, 1),
          color: sport.status === "live" ? "#f3bd4f" : "#d6b458",
        },
        home: {
          name: sport.homeName,
          shortName: sport.homeName.slice(0, 3).toUpperCase(),
          score: sport.homeScore,
          mark: sport.homeName.slice(0, 1),
          color: sport.status === "live" ? "#5799f4" : "#ae5cbb",
        },
      })),
    [sportsEvents],
  );
  const weatherDisplay = toWeatherDisplay(weatherForDisplay);
  const heroTime = formatHeroTime(effectiveNow);
  // A same-day cache stays visible after a provider is disconnected, but it
  // is explicitly labeled stale rather than replaced with a preview fixture.
  const githubDisplayCount = githubToday;
  const upcomingAlarm = useMemo(
    () => nextScheduledAlarmOccurrence(localData.alarms, effectiveNow.getTime()),
    [effectiveNow, localData.alarms],
  );
  const alarmForSurface = activeAlarm ?? upcomingAlarm;
  const alarmDisplay = alarmForSurface
    ? toAlarmDisplayData(
        alarmForSurface.alarm,
        alarmForSurface.occursAt,
        effectiveNow,
        activeAlarm?.source,
      )
    : undefined;
  const currentReminder = remindersForDate(localData.reminders, dateKey)[0];
  const googleCalendarConnected = Boolean(secureStatus?.googleRefreshTokenConfigured);
  const canInteract = modeAllowsPointerEvents(display.mode);

  const handleTaskToggle = (taskId: string, nextCompleted: boolean) => {
    const nextStates = nextCompleted
      ? markTaskCompleted(localData.taskStates, taskId, dateKey, new Date().toISOString())
      : markTaskIncomplete(localData.taskStates, taskId, dateKey);
    const celebration = createTaskCompletionCelebration(
      localData.tasks,
      nextStates,
      localData.celebrations,
      dateKey,
      new Date().toISOString(),
    );
    const nextData: LocalData = {
      ...localData,
      taskStates: nextStates,
      celebrations: celebration ? [...localData.celebrations, celebration] : localData.celebrations,
    };
    setLocalData(nextData);
    if (celebration) {
      window.setTimeout(() => dispatchDisplay({ type: "CELEBRATION_TRIGGERED" }), 0);
    }
  };

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setWeatherStatus({ state: "error", message: "Location is not available in this webview." });
      return;
    }
    setWeatherStatus({ state: "loading", message: "Requesting location…" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation: WeatherLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "Current location",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        window.localStorage.setItem("ambient-glass.weather-location", JSON.stringify(nextLocation));
        setLocation(nextLocation);
      },
      () =>
        setWeatherStatus({
          state: "error",
          message: "Location was not granted. Weather remains unavailable.",
        }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60 * 60 * 1_000 },
    );
  };

  const executeCommand = async (input: string) => {
    const parsed = parseTypedCommand(input, {
      now: effectiveNow,
      dayPart: automaticScene.dayPart,
    });
    if (!parsed.ok) {
      setCommandMessage(parsed.message);
      return;
    }
    await executeAmbientCommand(parsed.command, {
      dateKey,
      localData,
      setLocalData,
      dispatchDisplay,
      setCommandMessage,
      setSceneLock,
      setSceneMessage,
      snoozeActiveAlarm,
      triggerCelebration: () => dispatchDisplay({ type: "CELEBRATION_TRIGGERED" }),
    });
  };

  const startVoice = async () => {
    if (voiceState !== "idle") {
      return;
    }
    try {
      recorderRef.current ??= new PushToTalkRecorder();
      await recorderRef.current.start();
      setVoiceState("recording");
      setCommandMessage("Listening locally — release to transcribe.");
    } catch (error) {
      setVoiceState("unavailable");
      setCommandMessage(
        error instanceof Error ? error.message : "Voice is unavailable. Type a command instead.",
      );
    }
  };

  const stopVoice = async () => {
    if (voiceState !== "recording") {
      return;
    }
    setVoiceState("processing");
    try {
      const recording = await recorderRef.current?.stop();
      if (!recording) {
        setVoiceState("idle");
        return;
      }
      const transcript = await transcribeExplicitRecording(recording);
      if (!transcript) {
        setVoiceState("unavailable");
        setCommandMessage("No transcription provider is connected. Type the command instead.");
        return;
      }
      setCommandInput(transcript);
      await executeCommand(transcript);
      setVoiceState("idle");
    } catch {
      setVoiceState("error");
      setCommandMessage("Voice could not be processed. Type the command instead.");
    }
  };

  const cancelVoice = () => {
    recorderRef.current?.cancel();
    setVoiceState("idle");
    setCommandMessage("Voice capture cancelled. Type a command instead.");
  };

  const settingsContent = (
    <div className="app-settings">
      <section className="app-settings__section">
        <p className="app-settings__eyebrow">Display health</p>
        <StatusRow
          label="Wallpaper Engine"
          detail={wallpaperStatus.message ?? sceneMessage}
          state={wallpaperStatus.state}
        />
        <StatusRow
          label="Weather"
          detail={weatherStatus.message ?? weatherStatus.state}
          state={weatherStatus.state}
        />
        <StatusRow
          label="Camera"
          detail={cameraStatus.message}
          state={
            cameraStatus.state === "ready"
              ? "ready"
              : cameraStatus.state === "denied" || cameraStatus.state === "error"
                ? "error"
                : "stale"
          }
        />
        <StatusRow
          label="Calendar"
          detail={
            googleCalendarConnected
              ? (calendarProviderStatus.message ?? "Google Calendar connected")
              : currentReminder
                ? "Local reminder available"
                : "Local-first calendar ready"
          }
          state={googleCalendarConnected ? calendarProviderStatus.state : "ready"}
        />
        <StatusRow
          label="GitHub"
          detail={
            PREVIEW_CONFIG.preview
              ? "Deterministic preview fixture"
              : secureStatus?.githubTokenConfigured
                ? (githubProviderStatus.message ?? "Secure token available to the native provider")
                : githubDisplayCount !== null
                  ? "Cached GitHub total — reconnect to refresh"
                  : "No cached GitHub total — connect GitHub in secure desktop settings"
          }
          state={
            PREVIEW_CONFIG.preview
              ? "stale"
              : secureStatus?.githubTokenConfigured
                ? githubProviderStatus.state
                : githubDisplayCount !== null
                  ? "stale"
                  : "needs-auth"
          }
        />
        <StatusRow
          label="Sports"
          detail={
            PREVIEW_CONFIG.preview
              ? "Deterministic preview fixture"
              : secureStatus?.sportsApiKeyConfigured
                ? (sportsProviderStatus.message ?? "Secure provider key available")
                : sportsProviderStatus.state === "stale"
                  ? (sportsProviderStatus.message ?? "Cached sports scores — reconnect to refresh")
                  : "No cached scores — connect TheSportsDB in secure desktop settings"
          }
          state={
            PREVIEW_CONFIG.preview
              ? "stale"
              : secureStatus?.sportsApiKeyConfigured
                ? sportsProviderStatus.state
                : sportsProviderStatus.state === "stale"
                  ? "stale"
                  : "needs-auth"
          }
        />
        <StatusRow
          label="Voice"
          detail={
            secureStatus?.openaiTokenConfigured
              ? "Push-to-talk transcription is configured"
              : "Typed commands always available"
          }
          state={
            secureStatus?.openaiTokenConfigured
              ? "ready"
              : voiceState === "idle"
                ? "ready"
                : "stale"
          }
        />
        <StatusRow
          label="Alarm"
          detail={
            PREVIEW_CONFIG.preview
              ? "Preview uses the local alarm shell"
              : nativeAlarmStatus
                ? nativeAlarmStatus.message
                : "Browser fallback is ready; native scheduler is checking"
          }
          state={
            nativeAlarmStatus
              ? nativeAlarmStatus.persistentStorageReady
                ? "ready"
                : "error"
              : "stale"
          }
        />
        <StatusRow
          label="Startup"
          detail={
            autostart === null
              ? "Available in the native build"
              : autostart
                ? "Enabled"
                : "Disabled"
          }
          state={autostart ? "ready" : "stale"}
        />
      </section>
      <section className="app-settings__section app-settings__actions">
        <p className="app-settings__eyebrow">Privacy & setup</p>
        <button
          type="button"
          className={`glass-action ${
            localData.presenceEnabled ? "glass-action--quiet" : "glass-action--primary"
          }`}
          onClick={() => setPresenceEnabled(!localData.presenceEnabled)}
          aria-pressed={localData.presenceEnabled}
        >
          {localData.presenceEnabled
            ? "Disable local camera presence"
            : "Enable local camera presence"}
        </button>
        <p className="app-settings__presence-note">
          {localData.presenceEnabled
            ? "Saved locally. Future launches start local face detection; disable it to release the camera immediately."
            : `Off. No camera frames are stored or sent. ${inputWakeFallbackMessage()}`}
        </p>
        <button
          type="button"
          className="glass-action glass-action--quiet"
          onClick={requestLocation}
        >
          Use current location
        </button>
        <WallpaperSetup
          engineStatus={nativeWallpaperStatus}
          sceneLock={sceneLock}
          onEngineStatusChange={handleNativeWallpaperStatus}
          onFallbackChange={setWallpaperFallback}
          onSceneLockChange={setSceneLock}
          onSceneTest={handleWallpaperSceneTest}
        />
        <button
          type="button"
          className="glass-action glass-action--quiet"
          onClick={() =>
            void requestNativeNotificationPermission().then((granted) =>
              setCommandMessage(
                granted
                  ? "Native notifications are ready for active-app alarms."
                  : "Notifications were not granted; the in-app alarm remains available.",
              ),
            )
          }
        >
          Enable alarm notifications
        </button>
        {isTauriRuntime() && upcomingAlarm ? (
          <button
            type="button"
            className="glass-action glass-action--quiet"
            onClick={() =>
              void testNativeAlarm(upcomingAlarm.alarm.id).then((result) => {
                if (result.ok) {
                  setNativeAlarmStatus(result.value.status);
                  setCommandMessage(result.value.message);
                } else {
                  setCommandMessage(result.message);
                }
              })
            }
          >
            Test next native alarm
          </button>
        ) : null}
        <button
          type="button"
          className="glass-action glass-action--quiet"
          onClick={() =>
            void setAutostartEnabled(!autostart).then((changed) => {
              setCommandMessage(
                changed
                  ? !autostart
                    ? "Launch at startup enabled."
                    : "Launch at startup disabled."
                  : "Startup control is available in the native Windows build.",
              );
              refreshNativeStatus();
            })
          }
        >
          {autostart ? "Disable startup" : "Enable startup"}
        </button>
        {isTauriRuntime() ? (
          <button
            type="button"
            className="glass-action glass-action--quiet app-settings__quit"
            onClick={() => void quitNativeApplication()}
          >
            Quit Ambient Glass
          </button>
        ) : null}
        <div className="app-settings__secrets">
          <p className="app-settings__eyebrow">Secure provider connections</p>
          <ProviderSecretForm
            slot="githubToken"
            label="GitHub token"
            hint="Stored only in the native credential store."
            onSaved={refreshNativeStatus}
          />
          <ProviderSecretForm
            slot="sportsApiKey"
            label="TheSportsDB key"
            hint="Optional; real scores refresh only after this key is saved."
            onSaved={refreshNativeStatus}
          />
          <ProviderSecretForm
            slot="openaiApiKey"
            label="OpenAI transcription key"
            hint="Used only after explicit push-to-talk."
            onSaved={refreshNativeStatus}
          />
          <GoogleCalendarSetup
            connected={googleCalendarConnected}
            onConnectionChanged={() => {
              setGoogleCalendarEvents([]);
              setCalendarProviderStatus({
                state: "needs-auth",
                message: "Refreshing Google Calendar connection…",
              });
              refreshNativeStatus();
            }}
            onEventCreated={(event) => {
              if (calendarEventsForDate([event], dateKey).length === 0) {
                return;
              }
              setGoogleCalendarEvents((current) => dedupeCalendarEvents([...current, event]));
            }}
          />
        </div>
        <LocalRoutineSetup
          onAddTask={({ title, preferredTime, daysOfWeek }) => {
            setLocalData((current) => ({
              ...current,
              tasks: [
                ...current.tasks,
                {
                  id: stableId("task"),
                  title,
                  enabled: true,
                  daysOfWeek,
                  requiredForCelebration: true,
                  preferredTime,
                  sortOrder: current.tasks.length,
                },
              ],
            }));
            setCommandMessage(
              `Added “${title}” to ${daysOfWeek.length === 0 ? "daily" : "selected-day"} tasks.`,
            );
          }}
          onAddReminder={({ title, localTime, daysOfWeek }) => {
            const startsAt = zonedDateTimeToEpoch(dateKey, localTime);
            if (startsAt === undefined) {
              setCommandMessage(
                "That local reminder time does not exist today. Pick another time.",
              );
              return;
            }
            setLocalData((current) => ({
              ...current,
              reminders: [
                ...current.reminders,
                {
                  id: stableId("reminder"),
                  title,
                  startsAt: new Date(startsAt).toISOString(),
                  allDay: false,
                  recurrence:
                    daysOfWeek.length === 0
                      ? { frequency: "daily" }
                      : { frequency: "weekly", daysOfWeek },
                  notificationOffsetsMinutes: [10],
                  source: "local",
                },
              ],
            }));
            setCommandMessage(
              `Reminder saved for ${formatTaskTime(localTime)} ${
                daysOfWeek.length === 0 ? "every day" : "on selected days"
              }.`,
            );
          }}
          onAddAlarm={({ label, localTime, daysOfWeek }) => {
            setLocalData((current) => ({
              ...current,
              alarms: [
                ...current.alarms,
                {
                  id: stableId("alarm"),
                  label,
                  localTime,
                  daysOfWeek,
                  enabled: true,
                  soundId: "ambient-chime",
                  snoozeMinutes: 10,
                },
              ],
            }));
            setCommandMessage(
              `Alarm saved for ${formatTaskTime(localTime)} ${
                daysOfWeek.length === 0 ? "every day" : "on selected days"
              }.`,
            );
          }}
        />
        <p className="app-settings__notice">
          Alarms fire while Ambient Glass and the computer remain awake. Windows wake-from-sleep
          reliability needs the Dell validation pass.
        </p>
      </section>
    </div>
  );

  return (
    <div
      className={`app-shell app-shell--${display.mode}`}
      data-display-mode={display.mode}
      data-scene={sceneKey}
    >
      <AmbientDisplay
        mode={display.mode}
        contrast={
          weatherFamily === "clear" && weatherForDisplay.isDay ? "light-scene" : "dark-scene"
        }
        // Browser previews and native failures retain the calm internal scene.
        // A confirmed Wallpaper Engine pop-out sits directly behind the
        // transparent webview and becomes the actual app background.
        previewBackground={
          PREVIEW_CONFIG.preview || wallpaperFallback.active || !wallpaperHostReady
        }
        hero={{
          time: heroTime.time,
          meridiem: heroTime.meridiem,
          dateLabel: formatDateLabel(effectiveNow),
          greeting: greetingFor(effectiveNow),
          name: "Sahith",
          message:
            display.mode === "alarm"
              ? "Your morning briefing is ready."
              : "Hope you had a productive day.",
        }}
        weather={weatherDisplay}
        calendar={{
          dateRange: calendarCard.dateRange,
          days: calendarCard.days,
          event: event
            ? {
                id: event.id,
                title: event.title,
                time: formatEventTime(event.startsAt, event.endsAt, effectiveNow, event.allDay),
              }
            : null,
        }}
        contributions={
          githubDisplayCount === null
            ? undefined
            : {
                count: githubDisplayCount,
                label: `${githubDisplayCount} ${githubDisplayCount === 1 ? "commit" : "commits"} today`,
                sourceLabel: "GitHub commits",
                caption: PREVIEW_CONFIG.preview
                  ? "Mock preview · connect GitHub in settings"
                  : githubProviderStatus.state === "stale" || !secureStatus?.githubTokenConfigured
                    ? "Cached GitHub total"
                    : "Commits counted by GitHub",
                // The backend contract exposes totalCommitContributions only;
                // it does not claim to provide a contribution calendar.
                activityDetailAvailable: PREVIEW_CONFIG.preview,
                activityDetailMessage: "GitHub provided today’s total only",
              }
        }
        tasks={taskDisplays}
        scores={scoreDisplays}
        alarm={alarmDisplay}
        celebration={{
          visible:
            display.mode === "celebration" ||
            (PREVIEW_CONFIG.preview && (display.mode === "glance" || display.mode === "awakening")),
        }}
        voice={{
          listening: voiceState === "recording",
          label: voiceState === "recording" ? "Release to send" : "Hold to talk",
          onPointerDown: () => void startVoice(),
          onPointerUp: () => void stopVoice(),
          onPointerCancel: cancelVoice,
        }}
        controls={{
          statusVisible: false,
          onWake: () => dispatchDisplay({ type: "MANUAL_WAKE" }),
          onSettings: () => dispatchDisplay({ type: "OPEN_SETTINGS" }),
        }}
        onToggleTask={canInteract ? handleTaskToggle : undefined}
        onAlarmEnabledChange={
          upcomingAlarm
            ? (enabled) => {
                if (!enabled) {
                  snoozedAlarmsRef.current.delete(upcomingAlarm.alarm.id);
                }
                setLocalData({
                  ...localData,
                  alarms: localData.alarms.map((item) =>
                    item.id === upcomingAlarm.alarm.id ? { ...item, enabled } : item,
                  ),
                });
              }
            : undefined
        }
        onSnoozeAlarm={activeAlarm ? () => void snoozeActiveAlarm() : undefined}
        onDismissAlarm={activeAlarm ? dismissActiveAlarm : undefined}
        onDismissCelebration={() => dispatchDisplay({ type: "CELEBRATION_FINISHED" })}
        settings={{
          onClose: () => dispatchDisplay({ type: "CLOSE_SETTINGS" }),
          children: settingsContent,
        }}
        debug={{
          open: debugOpen,
          mode: display.mode as PreviewMode,
          weather: debugWeather ?? toWeatherKind(weatherForDisplay),
          presence: previewPresence,
          onModeChange: (mode) => dispatchDisplay({ type: "FORCE_MODE", mode }),
          onWeatherChange: setDebugWeather,
          onPresenceChange: setPreviewPresence,
          onTriggerCelebration: () => dispatchDisplay({ type: "CELEBRATION_TRIGGERED" }),
        }}
        style={{ pointerEvents: canInteract ? "auto" : "none" }}
      />
      {display.mode === "interactive" ? (
        <section className="command-orb" aria-label="Voice and typed commands">
          <form
            className="command-orb__form"
            onSubmit={(event) => {
              event.preventDefault();
              void executeCommand(commandInput);
            }}
          >
            <label className="command-orb__label" htmlFor="ambient-command">
              Command
            </label>
            <input
              id="ambient-command"
              value={commandInput}
              onChange={(event) => setCommandInput(event.target.value)}
              placeholder="Remind me tomorrow at 9 AM to call the dentist"
              autoComplete="off"
            />
            <button type="submit" className="glass-action glass-action--primary">
              Send
            </button>
          </form>
          <p className="command-orb__message" role="status">
            {commandMessage}
          </p>
        </section>
      ) : null}
    </div>
  );
}

interface ExecuteCommandContext {
  dateKey: string;
  localData: LocalData;
  setLocalData: (data: LocalData) => void;
  dispatchDisplay: (event: DisplayEvent) => void;
  setCommandMessage: (message: string) => void;
  setSceneLock: (lock: SceneLock) => void;
  setSceneMessage: (message: string) => void;
  snoozeActiveAlarm: (minutes: number) => boolean;
  triggerCelebration: () => void;
}

async function executeAmbientCommand(
  command: AmbientCommand,
  context: ExecuteCommandContext,
): Promise<void> {
  switch (command.type) {
    case "create-reminder": {
      context.setLocalData({
        ...context.localData,
        reminders: [
          ...context.localData.reminders,
          {
            id: stableId("reminder"),
            title: command.title,
            startsAt: command.startsAt,
            allDay: command.allDay,
            notificationOffsetsMinutes: [10],
            source: "local",
          },
        ],
      });
      context.setCommandMessage(`Reminder created: ${command.title}.`);
      return;
    }
    case "add-task": {
      context.setLocalData({
        ...context.localData,
        tasks: [
          ...context.localData.tasks,
          {
            id: stableId("task"),
            title: command.title,
            enabled: true,
            daysOfWeek: [],
            requiredForCelebration: true,
            sortOrder: context.localData.tasks.length,
          },
        ],
      });
      context.setCommandMessage(`Added “${command.title}” to daily tasks.`);
      return;
    }
    case "complete-task": {
      const normalized = command.title.toLocaleLowerCase();
      const task = context.localData.tasks.find(
        (item) => item.title.toLocaleLowerCase() === normalized,
      );
      if (!task) {
        context.setCommandMessage(`I could not find “${command.title}” in your tasks.`);
        return;
      }
      const taskStates = markTaskCompleted(
        context.localData.taskStates,
        task.id,
        context.dateKey,
        new Date().toISOString(),
      );
      const celebration = createTaskCompletionCelebration(
        context.localData.tasks,
        taskStates,
        context.localData.celebrations,
        context.dateKey,
        new Date().toISOString(),
      );
      context.setLocalData({
        ...context.localData,
        taskStates,
        celebrations: celebration
          ? [...context.localData.celebrations, celebration]
          : context.localData.celebrations,
      });
      context.setCommandMessage(`Marked “${task.title}” complete.`);
      if (celebration) {
        window.setTimeout(context.triggerCelebration, 0);
      }
      return;
    }
    case "show-calendar":
      context.dispatchDisplay({ type: "ENTER_INTERACTIVE" });
      context.setCommandMessage("Showing today’s local-first calendar.");
      return;
    case "show-sports":
      context.dispatchDisplay({ type: "ENTER_INTERACTIVE" });
      context.setCommandMessage("Showing the sports ribbon.");
      return;
    case "show-tasks":
      context.dispatchDisplay({ type: "ENTER_INTERACTIVE" });
      context.setCommandMessage("Showing today’s focus tasks.");
      return;
    case "snooze":
      if (!context.snoozeActiveAlarm(command.minutes)) {
        context.setCommandMessage("There is no active alarm to snooze.");
        return;
      }
      context.setCommandMessage(`Alarm snoozed for ${command.minutes} minutes.`);
      return;
    case "lock-scene": {
      context.setSceneLock({ mode: "locked", sceneKey: command.sceneKey });
      context.setSceneMessage(
        `Scene locked to ${friendlySceneName(command.sceneKey)}; applying through the scene controller.`,
      );
      context.setCommandMessage(`Scene locked to ${friendlySceneName(command.sceneKey)}.`);
      return;
    }
    case "test-scene": {
      const result = await applyWallpaperScene(command.sceneKey, true);
      context.setSceneMessage(result.message);
      context.setCommandMessage(`Tested ${friendlySceneName(command.sceneKey)}.`);
      return;
    }
    case "use-automatic-scene":
      context.setSceneLock({ mode: "automatic" });
      context.setCommandMessage("Returned to automatic weather and time scenes.");
      return;
  }
}

function createInitialDisplay(config: PreviewConfig): DisplayState {
  const now = Date.now();
  if (config.mode) {
    return { mode: config.mode, enteredAt: now, bootTarget: "ambient" };
  }
  if (config.preview) {
    return { mode: config.presence ? "glance" : "ambient", enteredAt: now, bootTarget: "ambient" };
  }
  // A regular desktop app should open to useful, clickable content. Passive
  // ambient boot made sense for the old screen-covering overlay but looked
  // blank and unresponsive in a normal application window.
  return { mode: "glance", enteredAt: now, bootTarget: "ambient" };
}

interface InitialProviderData {
  githubToday: number | null;
  githubStatus: ProviderStatus;
  sportsEvents: SportsEvent[];
  sportsStatus: ProviderStatus;
}

function createInitialProviderData(now: Date): InitialProviderData {
  if (PREVIEW_CONFIG.preview) {
    return {
      githubToday: 5,
      githubStatus: { state: "stale", message: "Deterministic preview fixture" },
      sportsEvents: previewSports.map((event) => ({ ...event })),
      sportsStatus: { state: "stale", message: "Deterministic preview fixture" },
    };
  }

  const localDay = localDateKey(now);
  const github = localDay ? readCachedGithubToday(localDay) : null;
  const sports = localDay ? readCachedSportsEvents(localDay) : null;
  return {
    githubToday: github?.value.commits ?? null,
    githubStatus: github
      ? cachedProviderStatus("GitHub", github.savedAt)
      : { state: "needs-auth", message: "No cached GitHub total" },
    sportsEvents: sports?.value ?? [],
    sportsStatus: sports
      ? cachedProviderStatus("sports", sports.savedAt)
      : { state: "needs-auth", message: "No cached sports scores" },
  };
}

function cachedProviderStatus(provider: string, savedAt: string): ProviderStatus {
  return {
    state: "stale",
    lastUpdated: savedAt,
    message: `Showing cached ${provider} data from ${savedAt}.`,
  };
}

function initialLocalData(now: Date, preview: boolean): LocalData {
  if (!preview) {
    return withoutLegacyPreviewFixtures(loadLocalData("production"));
  }

  // Preview fixtures never share local storage with a person's actual tasks
  // or alarms. Retaining the privacy toggle is enough for the camera preview
  // test while keeping a reload visually deterministic.
  const storedPreviewData = loadLocalData("preview");
  const date = localDateKey(now) ?? "2026-05-11";
  return {
    ...createEmptyLocalData(),
    presenceEnabled: storedPreviewData.presenceEnabled,
    tasks: previewTasks.map((task) => ({ ...task })),
    taskStates: previewTasks.slice(0, 2).map((task) => ({
      taskId: task.id,
      date,
      completedAt: new Date(now).toISOString(),
    })),
    alarms: [{ ...previewAlarm }],
  };
}

/** Remove only the known pre-release fixture IDs from the old shared store. */
function withoutLegacyPreviewFixtures(data: LocalData): LocalData {
  const fixtureTaskIds = new Set(previewTasks.map((task) => task.id));
  const fixtureAlarmIds = new Set([previewAlarm.id]);
  const tasks = data.tasks.filter((task) => !fixtureTaskIds.has(task.id));
  const alarms = data.alarms.filter((alarm) => !fixtureAlarmIds.has(alarm.id));
  if (tasks.length === data.tasks.length && alarms.length === data.alarms.length) {
    return data;
  }
  return {
    ...data,
    tasks,
    taskStates: data.taskStates.filter((state) => !fixtureTaskIds.has(state.taskId)),
    alarms,
  };
}

function transitionForPresence(
  display: DisplayState,
  now: number,
  presence: ReturnType<typeof recordPresenceSample>,
): DisplayState {
  const action = derivePresenceAction(presence, {
    mode: display.mode,
    modeEnteredAt: display.enteredAt,
    now,
  });
  switch (action) {
    case "wake":
      return transitionDisplay(display, { type: "PRESENCE_CONFIRMED" }, now);
    case "dismiss":
      return transitionDisplay(display, { type: "ABSENCE_TIMEOUT" }, now);
    case "sleep":
      return transitionDisplay(display, { type: "SLEEP_TIMEOUT" }, now);
    case "none":
      return display;
  }
}

function transitionForShortcut(
  display: DisplayState,
  shortcut: ShortcutIntent,
  now: number,
): DisplayState {
  switch (shortcut.action) {
    case "toggle":
      return transitionDisplay(
        display,
        shortcut.visible ? { type: "MANUAL_WAKE" } : { type: "HIDE" },
        now,
      );
    case "interactive":
    case "debug":
      return transitionDisplay(display, { type: "ENTER_INTERACTIVE" }, now);
    case "settings":
      return transitionDisplay(display, { type: "OPEN_SETTINGS" }, now);
  }
}

function browserToggleWillReveal(mode: DisplayMode): boolean {
  return mode === "booting" || mode === "sleep" || mode === "ambient";
}

function isDisplayShortcut(event: Event): boolean {
  if (!(event instanceof KeyboardEvent)) {
    return false;
  }
  if (!event.ctrlKey || !event.shiftKey) {
    return false;
  }
  if (event.code === "Space" || event.key === " " || event.key === "Spacebar") {
    return true;
  }
  const key = event.key.toLowerCase();
  return key === "i" || key === "d" || key === ",";
}

function isModifierOnlyKey(event: Event): boolean {
  return (
    event instanceof KeyboardEvent &&
    (event.key === "Control" ||
      event.key === "Shift" ||
      event.key === "Alt" ||
      event.key === "Meta")
  );
}

function readPreviewConfig(): PreviewConfig {
  if (typeof window === "undefined") {
    return { preview: false, presence: false, offline: false, debug: false, reducedMotion: false };
  }
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get("mode");
  const time = params.get("time");
  const [hours, minutes] = time
    ?.match(/^(\d{1,2}):(\d{2})$/)
    ?.slice(1)
    .map(Number) ?? [19, 43];
  const validClock = hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60;
  const preview = params.get("preview") === "1";
  return {
    preview,
    mode:
      rawMode && MODE_VALUES.includes(rawMode as DisplayMode)
        ? (rawMode as DisplayMode)
        : undefined,
    weather: parseWeatherParam(params.get("weather")),
    presence: params.get("presence") !== "0",
    frozenNow: preview && validClock ? new Date(2024, 4, 11, hours, minutes) : undefined,
    offline: params.get("offline") === "1",
    debug: params.get("debug") === "1",
    reducedMotion: params.get("reduced-motion") === "1",
  };
}

function parseWeatherParam(value: string | null): WeatherCondition | undefined {
  switch (value) {
    case "clear":
    case "cloudy":
    case "partly-cloudy":
    case "rain":
    case "storm":
    case "fog":
    case "snow":
      return value === "cloudy" ? "partly-cloudy" : value;
    default:
      return undefined;
  }
}

function applyPreviewWeather(
  snapshot: WeatherSnapshot,
  weather: WeatherCondition | undefined,
): WeatherSnapshot {
  if (!weather) {
    return snapshot;
  }
  const codeByCondition: Record<WeatherCondition, number> = {
    clear: 0,
    "partly-cloudy": 2,
    cloudy: 3,
    rain: 63,
    storm: 95,
    fog: 45,
    snow: 73,
  };
  return { ...snapshot, weatherCode: codeByCondition[weather] };
}

function toWeatherDisplay(snapshot: WeatherSnapshot): WeatherDisplayData {
  const family = normalizeWmoCode(snapshot.weatherCode);
  const partlyCloudy = snapshot.weatherCode === 2;
  return {
    available: snapshot.temperatureC !== undefined && snapshot.weatherCode !== undefined,
    temperature: snapshot.temperatureC === undefined ? "—" : Math.round(snapshot.temperatureC),
    condition:
      family === "clear"
        ? partlyCloudy
          ? "Partly cloudy"
          : "Clear"
        : family === "cloudy"
          ? "Partly cloudy"
          : family === "rain"
            ? "Rain"
            : family === "storm"
              ? "Thunderstorm"
              : family === "snow"
                ? "Snow"
                : family === "fog"
                  ? "Fog"
                  : "Weather unavailable",
    kind: snapshot.weatherCode === undefined ? undefined : toWeatherKind(snapshot),
    wind: formatWindSpeed(snapshot.windSpeedKph),
    humidity: formatHumidity(snapshot.humidityPercent),
    high: snapshot.highC,
    low: snapshot.lowC,
  };
}

function formatWindSpeed(windSpeedKph: number | undefined): string | undefined {
  return windSpeedKph === undefined ? undefined : `${Math.round(windSpeedKph)} km/h`;
}

function formatHumidity(humidityPercent: number | undefined): string | undefined {
  return humidityPercent === undefined ? undefined : `${Math.round(humidityPercent)}%`;
}

function toWeatherKind(snapshot: WeatherSnapshot): WeatherCondition {
  if (snapshot.weatherCode === 2) {
    return "partly-cloudy";
  }
  switch (normalizeWmoCode(snapshot.weatherCode)) {
    case "clear":
      return "clear";
    case "cloudy":
      return "partly-cloudy";
    case "rain":
      return "rain";
    case "storm":
      return "storm";
    case "snow":
      return "snow";
    case "fog":
      return "fog";
    case "fallback":
      return "cloudy";
  }
}

function formatHeroTime(date: Date): { time: string; meridiem: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
    .formatToParts(date)
    .filter((part) => part.type !== "literal");
  return {
    time: `${parts.find((part) => part.type === "hour")?.value ?? "07"}:${parts.find((part) => part.type === "minute")?.value ?? "43"}`,
    meridiem: parts.find((part) => part.type === "dayPeriod")?.value ?? "PM",
  };
}

function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatTaskTime(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const date = new Date(2026, 0, 1, Number(match[1]), Number(match[2]));
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatEventTime(
  startsAt: string,
  endsAt: string | undefined,
  now: Date,
  allDay: boolean,
): string {
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : undefined;
  if (Number.isNaN(start.getTime())) return "Coming up";
  const format = (date: Date) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  const startDate = allDay && /^\d{4}-\d{2}-\d{2}$/.test(startsAt) ? startsAt : localDateKey(start);
  const currentDate = localDateKey(now);
  const tomorrow = currentDate ? addCalendarDays(currentDate, 1) : undefined;
  const dayLabel =
    startDate && currentDate && startDate === currentDate
      ? "Today"
      : startDate && tomorrow && startDate === tomorrow
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          }).format(start);
  if (allDay) {
    return `${dayLabel} · All day`;
  }
  return `${dayLabel}, ${format(start)}${end && !Number.isNaN(end.getTime()) ? ` – ${format(end)}` : ""}`;
}

/**
 * Recurring reminders retain their original ISO seed in storage. Resolve the
 * rendered occurrence onto the selected local day so a Wednesday reminder
 * created last month does not appear dated last month in today's calendar.
 */
function calendarEventForLocalDate(reminder: Reminder, date: string) {
  if (reminder.allDay || !reminder.recurrence) {
    return {
      id: reminder.id,
      title: reminder.title,
      startsAt: reminder.startsAt,
      endsAt: reminder.endsAt,
      allDay: reminder.allDay,
      source: reminder.source,
      externalId: reminder.externalId,
    };
  }

  const seed = new Date(reminder.startsAt);
  const localTime = `${String(seed.getHours()).padStart(2, "0")}:${String(
    seed.getMinutes(),
  ).padStart(2, "0")}`;
  const occurrence = zonedDateTimeToEpoch(date, localTime);
  return {
    id: reminder.id,
    title: reminder.title,
    startsAt: occurrence === undefined ? reminder.startsAt : new Date(occurrence).toISOString(),
    endsAt: reminder.endsAt,
    allDay: false,
    source: reminder.source,
    externalId: reminder.externalId,
  };
}

function calendarCardForDate(date: string): {
  days: CalendarDayDisplay[];
  dateRange: string;
} {
  const week = calendarWeekForDate(date);
  return {
    days: week.map((day) => ({
      weekday: formatCalendarWeekday(day),
      day: Number(day.slice(-2)),
      selected: day === date,
    })),
    dateRange: formatCalendarWeekRange(week),
  };
}

function formatCalendarWeekday(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00.000Z`),
  );
}

function formatCalendarWeekRange(week: string[]): string {
  const first = week[0];
  const last = week.at(-1);
  if (!first || !last) {
    return "This week";
  }
  const start = new Date(`${first}T12:00:00.000Z`);
  const end = new Date(`${last}T12:00:00.000Z`);
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  const startFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  if (sameMonth) {
    return `${startFormat.format(start)} – ${end.getUTCDate()}`;
  }
  return `${startFormat.format(start)} – ${startFormat.format(end)}`;
}

function createUnavailableWeatherSnapshot(): WeatherSnapshot {
  return { observedAt: new Date().toISOString() };
}

function inputWakeFallbackMessage(): string {
  return isTauriRuntime()
    ? "Keyboard and mouse activity can wake the ambient scene; Ctrl+Shift+Space works when available."
    : "Keyboard and mouse wake are available.";
}

function friendlySceneName(scene: SceneKey): string {
  return scene.replace(".", " · ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initialWallpaperStatus(): ProviderStatus {
  if (PREVIEW_CONFIG.preview || !isTauriRuntime()) {
    return previewWallpaperStatus();
  }
  return { state: "loading", message: "Checking Wallpaper Engine availability…" };
}

function previewWallpaperStatus(): ProviderStatus {
  return {
    state: "stale",
    message: PREVIEW_CONFIG.preview
      ? "Preview scene only; Wallpaper Engine is not invoked."
      : "Browser preview; Wallpaper Engine control is unavailable.",
  };
}

function wallpaperStatusFromNative(status: WallpaperEngineStatus): ProviderStatus {
  if (status.adapter === "native" && status.available) {
    return { state: "ready", message: status.message };
  }
  if (status.adapter === "mock") {
    return { state: "stale", message: status.message };
  }
  return { state: "error", message: status.message };
}

function wallpaperStatusFromOperation(result: WallpaperSceneResult): ProviderStatus {
  if (result.applied || result.duplicate) {
    return result.mocked
      ? { state: "stale", message: result.message }
      : { state: "ready", message: result.message };
  }
  return isTauriRuntime()
    ? { state: "error", message: result.message }
    : { state: "stale", message: result.message };
}

function wallpaperRetryDelay(retryCount: number): number | undefined {
  return WALLPAPER_RETRY_DELAYS_MS[retryCount];
}

function formatRetryDelay(delayMs: number): string {
  return `${Math.round(delayMs / 1_000)} seconds`;
}

function loadLocation(): WeatherLocation | null {
  try {
    const raw = window.localStorage.getItem("ambient-glass.weather-location");
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.latitude !== "number" ||
      typeof record.longitude !== "number" ||
      typeof record.label !== "string"
    ) {
      return null;
    }
    return {
      latitude: record.latitude,
      longitude: record.longitude,
      label: record.label,
      timezone: typeof record.timezone === "string" ? record.timezone : undefined,
    };
  } catch {
    return null;
  }
}

function stableId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function notifyAlarm(label: string): void {
  void sendAlarmNotification(label);
}

function notifyReminder(title: string): void {
  void sendAlarmNotification(`Reminder: ${title}`);
}

function compareAlarmTriggers(left: ActiveAlarm, right: ActiveAlarm): number {
  return (
    left.occursAt - right.occursAt ||
    left.alarm.id.localeCompare(right.alarm.id) ||
    left.source.localeCompare(right.source)
  );
}

function createSnoozedAlarmTrigger(alarm: Alarm, occursAt: number): ActiveAlarm {
  return {
    alarm,
    occursAt,
    occurrenceKey: `snooze:${alarm.id}:${new Date(occursAt).toISOString()}`,
    source: "snooze",
  };
}

function toAlarmDisplayData(
  alarm: Alarm,
  occursAt: number,
  now: Date,
  source?: AlarmTriggerSource,
): AlarmDisplayData {
  const match = /^(\d{2}):(\d{2})$/.exec(alarm.localTime);
  const hours = match ? Number(match[1]) : 0;
  const minutes = match ? match[2] : "00";
  const meridiem = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;

  return {
    time: `${hour}:${minutes}`,
    meridiem,
    dayLabel:
      source === "snooze"
        ? "Snoozed"
        : source === "scheduled"
          ? "Now"
          : formatAlarmDayLabel(occursAt, now),
    label: alarm.label,
    enabled: alarm.enabled,
  };
}

function formatAlarmDayLabel(occursAt: number, now: Date): string {
  const today = localDateKey(now);
  const occurrenceDate = localDateKey(new Date(occursAt));
  if (today && occurrenceDate === today) {
    return "Today";
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (occurrenceDate === localDateKey(tomorrow)) {
    return "Tomorrow";
  }
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(occursAt));
}

interface AlarmToneController {
  stop: () => void;
}

/**
 * Repeats the bundled local chime until the current alert resolves. If the
 * browser/webview rejects or cannot load that media element, retain the
 * synthesized WebAudio chime as an entirely local fallback.
 */
function startRepeatingAlarmTone(): AlarmToneController | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const audio = new Audio(BUNDLED_ALARM_CHIME_URL);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0.72;

    let stopped = false;
    let fallbackStarted = false;
    let fallbackTone: AlarmToneController | undefined;
    const startFallback = () => {
      if (stopped || fallbackStarted) {
        return;
      }
      fallbackStarted = true;
      audio.pause();
      fallbackTone = startRepeatingWebAudioAlarmTone();
    };

    // A rejected `play()` commonly indicates an autoplay policy. An `error`
    // event covers unavailable/unsupported local media without retry loops.
    audio.addEventListener("error", startFallback, { once: true });
    void audio.play().catch(startFallback);

    return {
      stop: () => {
        if (stopped) {
          return;
        }
        stopped = true;
        audio.removeEventListener("error", startFallback);
        audio.pause();
        audio.currentTime = 0;
        fallbackTone?.stop();
        fallbackTone = undefined;
      },
    };
  } catch {
    return startRepeatingWebAudioAlarmTone();
  }
}

/** The safe, dependency-free fallback when bundled media cannot play. */
function startRepeatingWebAudioAlarmTone(): AlarmToneController | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextConstructor) {
    return undefined;
  }

  try {
    const context = new AudioContextConstructor();
    const oscillators = new Set<OscillatorNode>();
    let stopped = false;
    const playChime = () => {
      if (stopped || context.state === "closed") {
        return;
      }
      const startedAt = context.currentTime + 0.02;
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const offset = index * 0.31;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startedAt + offset);
        gain.gain.setValueAtTime(0.0001, startedAt + offset);
        gain.gain.exponentialRampToValueAtTime(0.12, startedAt + offset + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + offset + 0.27);
        oscillator.connect(gain).connect(context.destination);
        oscillator.onended = () => oscillators.delete(oscillator);
        oscillators.add(oscillator);
        oscillator.start(startedAt + offset);
        oscillator.stop(startedAt + offset + 0.29);
      });
    };

    playChime();
    // The native webview is normally already user-activated; resume is a
    // harmless best-effort for browsers that initially suspend WebAudio.
    void context.resume().catch(() => undefined);
    const interval = window.setInterval(playChime, 2_400);
    return {
      stop: () => {
        if (stopped) {
          return;
        }
        stopped = true;
        window.clearInterval(interval);
        oscillators.forEach((oscillator) => {
          try {
            oscillator.stop();
          } catch {
            // An oscillator that already ended does not need further cleanup.
          }
        });
        oscillators.clear();
        void context.close().catch(() => undefined);
      },
    };
  } catch {
    // The in-app alarm view and notification remain reliable fallbacks.
    return undefined;
  }
}

function StatusRow({ label, detail, state }: { label: string; detail: string; state: string }) {
  return (
    <div className="app-settings__status-row">
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <i className={`app-settings__state app-settings__state--${state}`} aria-label={state} />
    </div>
  );
}

function ProviderSecretForm({
  slot,
  label,
  hint,
  onSaved,
}: {
  slot: ProviderSecretSlot;
  label: string;
  hint: string;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState("");
  return (
    <form
      className="provider-secret-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const secret = new FormData(form).get("secret");
        if (typeof secret !== "string") {
          return;
        }
        void saveProviderSecret(slot, secret).then((result) => {
          setMessage(result.message);
          if (result.ok) {
            form.reset();
            onSaved();
          }
        });
      }}
    >
      <label>
        <span>{label}</span>
        <input
          name="secret"
          type="password"
          autoComplete="off"
          placeholder="Paste only when connecting"
        />
      </label>
      <button className="glass-action glass-action--quiet" type="submit">
        Save securely
      </button>
      <small>{message || hint}</small>
      {isTauriRuntime() ? (
        <button
          type="button"
          className="provider-secret-form__disconnect"
          onClick={() =>
            void deleteProviderSecret(slot).then((result) => {
              setMessage(result.message);
              if (result.ok) {
                onSaved();
              }
            })
          }
        >
          Disconnect
        </button>
      ) : null}
    </form>
  );
}
