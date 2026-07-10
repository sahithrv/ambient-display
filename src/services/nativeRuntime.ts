import type { Alarm, CalendarEvent } from "../domain";
import { invokeTauri, invokeTauriResult, isTauriRuntime, type TauriInvocation } from "./tauri";

export type ProviderSecretSlot =
  "githubToken" | "sportsApiKey" | "openaiApiKey" | "googleRefreshToken";

export interface SecureStorageStatus {
  backendOnly: boolean;
  mode: "native" | "mock" | "unconfigured";
  githubTokenConfigured: boolean;
  sportsApiKeyConfigured: boolean;
  openaiTokenConfigured: boolean;
  googleRefreshTokenConfigured: boolean;
  frontendTokenAccess: boolean;
  message: string;
}

export interface CredentialActionResult {
  ok: boolean;
  message: string;
}

/** Deliberately status-only: OAuth codes, verifiers, and tokens stay native. */
export interface GoogleCalendarOAuthStatus {
  connected: boolean;
  pending: boolean;
  message: string;
}

export interface GoogleCalendarEventInput {
  title: string;
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
}

export type NativeAlarmEventKind = "triggered" | "snoozed" | "dismissed" | "test";

export interface NativeAlarmNotificationStatus {
  ready: boolean;
  sent: boolean;
  permission: string;
  message: string;
}

export interface NativeAlarmAudioStatus {
  ready: boolean;
  message: string;
}

export interface NativeActiveAlarm {
  alarm: Alarm;
  occurrenceKey: string;
  triggeredAtMs: number;
  source: "scheduled" | "snooze" | "test";
}

export interface NativeAlarmSchedulerStatus {
  appActiveOnly: boolean;
  persistentStorageReady: boolean;
  notification: NativeAlarmNotificationStatus;
  audio: NativeAlarmAudioStatus;
  message: string;
}

export interface NativeAlarmEvent {
  kind: NativeAlarmEventKind;
  active: NativeActiveAlarm;
  notification: NativeAlarmNotificationStatus;
  audio: NativeAlarmAudioStatus;
  message: string;
}

export interface NativeAlarmListResponse {
  alarms: Alarm[];
  active?: NativeActiveAlarm;
  status: NativeAlarmSchedulerStatus;
}

export interface NativeAlarmMutationResponse {
  alarm?: Alarm;
  active?: NativeActiveAlarm;
  status: NativeAlarmSchedulerStatus;
  message: string;
}

export async function saveProviderSecret(
  slot: ProviderSecretSlot,
  value: string,
): Promise<CredentialActionResult> {
  if (!value.trim()) {
    return { ok: false, message: "Enter a value before saving." };
  }
  const result = await invokeTauriResult<{ message: string }>("save_provider_secret", {
    slot,
    value,
  });
  return result.ok
    ? { ok: true, message: result.value.message }
    : { ok: false, message: result.message };
}

export async function deleteProviderSecret(
  slot: ProviderSecretSlot,
): Promise<CredentialActionResult> {
  const result = await invokeTauriResult<{ message: string }>("delete_provider_secret", { slot });
  return result.ok
    ? { ok: true, message: result.value.message }
    : { ok: false, message: result.message };
}

export async function secureStorageStatus(): Promise<SecureStorageStatus | null> {
  return invokeTauri<SecureStorageStatus>("get_secure_token_storage_status");
}

/** Launches installed-app OAuth in the system browser, never inside the webview. */
export async function beginGoogleCalendarOAuth(): Promise<GoogleCalendarOAuthStatus> {
  return googleCalendarOAuthAction("begin_google_calendar_oauth");
}

/** Polls the native loopback callback; no OAuth material is returned to React. */
export async function completeGoogleCalendarOAuth(): Promise<GoogleCalendarOAuthStatus> {
  return googleCalendarOAuthAction("complete_google_calendar_oauth");
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarOAuthStatus> {
  return googleCalendarOAuthAction("disconnect_google_calendar");
}

export async function createGoogleCalendarEvent(
  event: GoogleCalendarEventInput,
): Promise<TauriInvocation<CalendarEvent>> {
  return invokeTauriResult<CalendarEvent>("create_google_calendar_event", { event });
}

export async function listNativeAlarms(): Promise<TauriInvocation<NativeAlarmListResponse>> {
  return invokeTauriResult<NativeAlarmListResponse>("list_native_alarms");
}

export async function nativeAlarmSchedulerStatus(): Promise<
  TauriInvocation<NativeAlarmSchedulerStatus>
> {
  return invokeTauriResult<NativeAlarmSchedulerStatus>("get_native_alarm_scheduler_status");
}

export async function scheduleNativeAlarm(
  alarm: Alarm,
): Promise<TauriInvocation<NativeAlarmMutationResponse>> {
  return invokeTauriResult<NativeAlarmMutationResponse>("schedule_native_alarm", { alarm });
}

export async function snoozeNativeAlarm(
  id: string,
  minutes?: number,
): Promise<TauriInvocation<NativeAlarmMutationResponse>> {
  return invokeTauriResult<NativeAlarmMutationResponse>("snooze_native_alarm", { id, minutes });
}

export async function dismissNativeAlarm(
  id: string,
): Promise<TauriInvocation<NativeAlarmMutationResponse>> {
  return invokeTauriResult<NativeAlarmMutationResponse>("dismiss_native_alarm", { id });
}

export async function testNativeAlarm(
  id: string,
): Promise<TauriInvocation<NativeAlarmMutationResponse>> {
  return invokeTauriResult<NativeAlarmMutationResponse>("test_native_alarm", { id });
}

/** Subscribes only to normalized scheduler events; malformed event payloads are ignored. */
export async function listenForNativeAlarms(
  onAlarm: (event: NativeAlarmEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<unknown>("ambient-glass://alarm", ({ payload }) => {
      const event = normalizeNativeAlarmEvent(payload);
      if (event) {
        onAlarm(event);
      }
    });
  } catch {
    return () => undefined;
  }
}

async function googleCalendarOAuthAction(command: string): Promise<GoogleCalendarOAuthStatus> {
  const result = await invokeTauriResult<GoogleCalendarOAuthStatus>(command);
  return result.ok ? result.value : { connected: false, pending: false, message: result.message };
}

function normalizeNativeAlarmEvent(value: unknown): NativeAlarmEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const active = normalizeNativeActiveAlarm(record.active);
  const notification = normalizeNativeAlarmNotification(record.notification);
  const audio = normalizeNativeAlarmAudio(record.audio);
  if (
    (kind !== "triggered" && kind !== "snoozed" && kind !== "dismissed" && kind !== "test") ||
    !active ||
    !notification ||
    !audio ||
    typeof record.message !== "string"
  ) {
    return null;
  }
  return { kind, active, notification, audio, message: record.message };
}

function normalizeNativeActiveAlarm(value: unknown): NativeActiveAlarm | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const alarm = normalizeNativeAlarm(record.alarm);
  const triggeredAtMs = record.triggeredAtMs;
  if (
    !alarm ||
    typeof record.occurrenceKey !== "string" ||
    typeof triggeredAtMs !== "number" ||
    !Number.isFinite(triggeredAtMs) ||
    (record.source !== "scheduled" && record.source !== "snooze" && record.source !== "test")
  ) {
    return null;
  }
  return {
    alarm,
    occurrenceKey: record.occurrenceKey,
    triggeredAtMs,
    source: record.source,
  };
}

function normalizeNativeAlarm(value: unknown): Alarm | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const snoozeMinutes = record.snoozeMinutes;
  if (
    typeof record.id !== "string" ||
    typeof record.label !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(record.localTime ?? "")) ||
    !Array.isArray(record.daysOfWeek) ||
    !record.daysOfWeek.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) ||
    typeof record.enabled !== "boolean" ||
    typeof record.soundId !== "string" ||
    typeof snoozeMinutes !== "number" ||
    !Number.isInteger(snoozeMinutes) ||
    snoozeMinutes < 1 ||
    snoozeMinutes > 240
  ) {
    return null;
  }
  return {
    id: record.id,
    label: record.label,
    localTime: record.localTime as string,
    daysOfWeek: record.daysOfWeek as number[],
    enabled: record.enabled,
    soundId: record.soundId,
    snoozeMinutes,
  };
}

function normalizeNativeAlarmNotification(value: unknown): NativeAlarmNotificationStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record.ready === "boolean" &&
    typeof record.sent === "boolean" &&
    typeof record.permission === "string" &&
    typeof record.message === "string"
    ? {
        ready: record.ready,
        sent: record.sent,
        permission: record.permission,
        message: record.message,
      }
    : null;
}

function normalizeNativeAlarmAudio(value: unknown): NativeAlarmAudioStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record.ready === "boolean" && typeof record.message === "string"
    ? { ready: record.ready, message: record.message }
    : null;
}

export async function getAutostartEnabled(): Promise<boolean | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    return await isEnabled();
  } catch {
    return null;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  try {
    const plugin = await import("@tauri-apps/plugin-autostart");
    if (enabled) {
      await plugin.enable();
    } else {
      await plugin.disable();
    }
    return true;
  } catch {
    return false;
  }
}

/** Native notification requests are user-initiated in settings; alarms never prompt unexpectedly. */
export async function requestNativeNotificationPermission(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return typeof Notification !== "undefined" && Notification.permission === "granted";
  }
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    if (await notification.isPermissionGranted()) {
      return true;
    }
    return (await notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export async function sendAlarmNotification(label: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const notification = await import("@tauri-apps/plugin-notification");
      if (await notification.isPermissionGranted()) {
        notification.sendNotification({ title: "Ambient Glass", body: label });
      }
    } catch {
      // The in-app alarm view remains the primary channel.
    }
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("Ambient Glass", { body: label });
  }
}
