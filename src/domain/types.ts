/**
 * Browser-safe, JSON-friendly models shared by Ambient Glass features.
 *
 * Dates are intentionally represented as ISO strings. Keeping domain state free
 * of Date instances makes it safe to put directly into Tauri Store/localStorage
 * and keeps time-zone conversion at the boundary helpers.
 */

export type LocalDate = string;
export type IsoDateTime = string;

export type ProviderState = "ready" | "loading" | "stale" | "offline" | "needs-auth" | "error";

export interface ProviderStatus {
  state: ProviderState;
  lastUpdated?: IsoDateTime;
  message?: string;
}

export type DisplayMode =
  | "booting"
  | "sleep"
  | "ambient"
  | "awakening"
  | "glance"
  | "interactive"
  | "alarm"
  | "celebration"
  | "settings";

export type WeatherFamily = "clear" | "cloudy" | "rain" | "storm" | "fog" | "snow" | "fallback";

export type DayPart = "dawn" | "day" | "sunset" | "night";

export type SceneKey =
  | "clear.dawn"
  | "clear.day"
  | "clear.sunset"
  | "clear.night"
  | "cloudy.day"
  | "cloudy.night"
  | "rain.day"
  | "rain.night"
  | "storm.any"
  | "fog.any"
  | "snow.any"
  | "fallback.any";

export type ContrastProfile = "light-scene" | "dark-scene" | "mixed-scene";

export interface WeatherSnapshot {
  observedAt: IsoDateTime;
  weatherCode?: number;
  temperatureC?: number;
  apparentTemperatureC?: number;
  /** Open-Meteo `wind_speed_10m`, requested with `wind_speed_unit=kmh`. */
  windSpeedKph?: number;
  /** Open-Meteo `relative_humidity_2m`, expressed as a percentage. */
  humidityPercent?: number;
  highC?: number;
  lowC?: number;
  sunrise?: IsoDateTime;
  sunset?: IsoDateTime;
  isDay?: boolean;
}

export interface SceneLock {
  mode: "automatic" | "locked";
  sceneKey?: SceneKey;
}

export interface ReminderRecurrence {
  /** A daily recurrence can leave `daysOfWeek` empty. */
  frequency: "daily" | "weekly";
  /** Sunday is 0 and Saturday is 6, matching `Date#getDay`. */
  daysOfWeek?: number[];
}

export interface Reminder {
  id: string;
  title: string;
  startsAt: IsoDateTime;
  endsAt?: IsoDateTime;
  allDay: boolean;
  recurrence?: ReminderRecurrence;
  notificationOffsetsMinutes: number[];
  source: "local" | "google";
  externalId?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: IsoDateTime;
  endsAt?: IsoDateTime;
  allDay: boolean;
  source: "local" | "google";
  externalId?: string;
}

export interface RepeatingTask {
  id: string;
  title: string;
  enabled: boolean;
  /** Sunday is 0 and Saturday is 6. An empty array means every day. */
  daysOfWeek: number[];
  requiredForCelebration: boolean;
  preferredTime?: string;
  sortOrder: number;
}

export interface DailyTaskState {
  date: LocalDate;
  taskId: string;
  completedAt?: IsoDateTime;
}

export interface DailyTaskInstance {
  date: LocalDate;
  task: RepeatingTask;
  completedAt?: IsoDateTime;
}

export interface TaskProgress {
  total: number;
  completed: number;
  requiredTotal: number;
  requiredCompleted: number;
}

export interface CelebrationEvent {
  date: LocalDate;
  reason: "all-required-tasks-complete";
  playedAt: IsoDateTime;
}

export interface Alarm {
  id: string;
  label: string;
  /** 24-hour local time in HH:mm form. */
  localTime: string;
  /** Sunday is 0 and Saturday is 6. An empty array means every day. */
  daysOfWeek: number[];
  enabled: boolean;
  soundId: string;
  snoozeMinutes: number;
}

export interface SportsEvent {
  id: string;
  sport: string;
  league: string;
  startTime: IsoDateTime;
  homeName: string;
  awayName: string;
  homeBadgeUrl?: string;
  awayBadgeUrl?: string;
  homeScore?: number;
  awayScore?: number;
  status: "scheduled" | "live" | "final" | "postponed" | "cancelled";
  clockOrPeriod?: string;
}

export interface SportsPreferences {
  favoriteTeams?: string[];
  favoriteLeagues?: string[];
}

export interface LocalData {
  version: 1;
  /** Explicit local-only camera opt-in; persisted with other non-secret settings. */
  presenceEnabled: boolean;
  tasks: RepeatingTask[];
  taskStates: DailyTaskState[];
  reminders: Reminder[];
  alarms: Alarm[];
  celebrations: CelebrationEvent[];
}

export type CommandParseFailureReason =
  "empty" | "ambiguous" | "unsupported" | "invalid-date" | "invalid-time";

export type AmbientCommand =
  | {
      type: "create-reminder";
      title: string;
      startsAt: IsoDateTime;
      allDay: boolean;
    }
  | { type: "add-task"; title: string }
  | { type: "complete-task"; title: string }
  | { type: "show-calendar" }
  | { type: "show-sports" }
  | { type: "show-tasks" }
  | { type: "snooze"; minutes: number }
  | { type: "lock-scene"; sceneKey: SceneKey }
  | { type: "test-scene"; sceneKey: SceneKey }
  | { type: "use-automatic-scene" };

export type CommandParseResult =
  | { ok: true; command: AmbientCommand; normalizedInput: string }
  | {
      ok: false;
      reason: CommandParseFailureReason;
      message: string;
      normalizedInput: string;
    };
