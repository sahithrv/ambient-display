//! Narrow commands for the app-active native alarm scheduler.

use chrono::Local;
use tauri::{AppHandle, State};

use crate::alarms::{
    emit_alarm_event, AlarmSchedulerError, NativeAlarmInput, NativeAlarmListResponse,
    NativeAlarmMutationResponse, NativeAlarmScheduler, NativeAlarmSchedulerStatus,
};

/// Returns all persisted non-secret schedules, the in-memory active alarm, and
/// truthful notification/audio readiness for the current native runtime.
#[tauri::command]
pub fn list_native_alarms(
    app: AppHandle,
    scheduler: State<'_, NativeAlarmScheduler>,
) -> NativeAlarmListResponse {
    scheduler.list(&app)
}

/// Returns just the scheduler health when the UI does not need the full list.
#[tauri::command]
pub fn get_native_alarm_scheduler_status(
    app: AppHandle,
    scheduler: State<'_, NativeAlarmScheduler>,
) -> NativeAlarmSchedulerStatus {
    scheduler.status(&app)
}

/// Creates or replaces one validated, non-secret native alarm schedule.
#[tauri::command]
pub fn schedule_native_alarm(
    alarm: NativeAlarmInput,
    app: AppHandle,
    scheduler: State<'_, NativeAlarmScheduler>,
) -> Result<NativeAlarmMutationResponse, AlarmSchedulerError> {
    let alarm = scheduler.schedule(alarm)?;
    Ok(NativeAlarmMutationResponse {
        alarm: Some(alarm),
        active: scheduler.active(),
        status: scheduler.status(&app),
        message: "Native alarm schedule saved.".to_owned(),
    })
}

/// Snoozes only the matching active native alarm. The resulting state is
/// persisted and an `ambient-glass://alarm` `snoozed` event is emitted.
#[tauri::command]
pub fn snooze_native_alarm(
    id: String,
    minutes: Option<u16>,
    app: AppHandle,
    scheduler: State<'_, NativeAlarmScheduler>,
) -> Result<NativeAlarmMutationResponse, AlarmSchedulerError> {
    let event = emit_alarm_event(&app, scheduler.snooze(&id, minutes, Local::now())?);
    Ok(NativeAlarmMutationResponse {
        alarm: Some(event.active.alarm.clone()),
        active: scheduler.active(),
        status: scheduler.status(&app),
        message: event.message,
    })
}

/// Dismissal is intentionally idempotent: a stale UI action returns a useful
/// response instead of exposing internal active-alarm state as an error.
#[tauri::command]
pub fn dismiss_native_alarm(
    id: String,
    app: AppHandle,
    scheduler: State<'_, NativeAlarmScheduler>,
) -> Result<NativeAlarmMutationResponse, AlarmSchedulerError> {
    let event = scheduler.dismiss(&id)?;
    let (alarm, message) = match event {
        Some(event) => {
            let event = emit_alarm_event(&app, event);
            (Some(event.active.alarm), event.message)
        }
        None => (None, "No active native alarm matched that id.".to_owned()),
    };
    Ok(NativeAlarmMutationResponse {
        alarm,
        active: scheduler.active(),
        status: scheduler.status(&app),
        message,
    })
}

/// Emits a test event and performs a best-effort native notification if the
/// user has already granted permission. It never modifies the schedule or
/// pretends that a custom native sound asset is available.
#[tauri::command]
pub fn test_native_alarm(
    id: String,
    app: AppHandle,
    scheduler: State<'_, NativeAlarmScheduler>,
) -> Result<NativeAlarmMutationResponse, AlarmSchedulerError> {
    let event = emit_alarm_event(&app, scheduler.test(&id, Local::now())?);
    Ok(NativeAlarmMutationResponse {
        alarm: Some(event.active.alarm.clone()),
        active: scheduler.active(),
        status: scheduler.status(&app),
        message: event.message,
    })
}
