//! App-active native alarm scheduling.
//!
//! This module deliberately does not attempt to wake a suspended computer or
//! become a background service. While Ambient Glass is running, it persists
//! non-secret schedules and snoozes locally, emits a typed Tauri event when an
//! alarm is due, and uses the already-installed notification plugin only when
//! the user has granted permission. Browser/WebAudio remains the fallback for
//! alert sound because this native scheduler deliberately does not own an
//! independent cross-platform audio player. The frontend plays its bundled
//! local chime while the app is active.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt, fs,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};

use chrono::{DateTime, Datelike, Duration as ChronoDuration, Local, Timelike};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::{NotificationExt, PermissionState};

const ALARM_EVENT: &str = "ambient-glass://alarm";
const ALARM_STATE_FILE: &str = "native-alarms-v1.json";
const ALARM_STATE_VERSION: u8 = 1;
const MAX_ALARMS: usize = 128;
const MAX_LABEL_CHARS: usize = 120;
const MAX_ID_CHARS: usize = 96;
const MAX_SOUND_ID_CHARS: usize = 64;
const MIN_SNOOZE_MINUTES: u16 = 1;
const MAX_SNOOZE_MINUTES: u16 = 240;
/// A delayed app-process timer can skip a whole minute. Match the browser
/// fallback's bounded recovery window while the same process remains alive;
/// a longer discontinuity is treated like suspend/resume rather than replaying
/// stale alarms.
const ACTIVE_APP_ALARM_RECOVERY_MINUTES: i64 = 15;
const ACTIVE_APP_ALARM_RECOVERY_MILLIS: i64 = ACTIVE_APP_ALARM_RECOVERY_MINUTES * 60_000;

/// A frontend-compatible, non-secret alarm schedule.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAlarm {
    pub id: String,
    pub label: String,
    /// Local 24-hour `HH:MM`; it is intentionally evaluated in the operating
    /// system's current local time zone while the app process is running.
    pub local_time: String,
    /// Sunday is 0 through Saturday is 6. An empty list means every day.
    pub days_of_week: Vec<u8>,
    pub enabled: bool,
    /// Retained for the shared UI model. Native code never treats this as a
    /// file path or tries to load arbitrary audio.
    pub sound_id: String,
    pub snooze_minutes: u16,
}

/// Schedule input is distinct so safe defaults can be supplied at the IPC
/// boundary without making persisted data optional or ambiguous.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAlarmInput {
    pub id: String,
    pub label: String,
    pub local_time: String,
    #[serde(default)]
    pub days_of_week: Vec<u8>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_sound_id")]
    pub sound_id: String,
    #[serde(default = "default_snooze_minutes")]
    pub snooze_minutes: u16,
}

impl NativeAlarmInput {
    fn into_alarm(mut self) -> Result<NativeAlarm, AlarmSchedulerError> {
        self.id = normalized_identifier(&self.id)?;
        self.label = normalized_label(&self.label)?;
        validate_local_time(&self.local_time)?;
        self.days_of_week.sort_unstable();
        self.days_of_week.dedup();
        if self.days_of_week.iter().any(|day| *day > 6) {
            return Err(validation_error(
                "daysOfWeek",
                "Alarm days must use Sunday (0) through Saturday (6).",
            ));
        }
        self.sound_id = normalized_sound_id(&self.sound_id)?;
        validate_snooze_minutes(self.snooze_minutes)?;

        Ok(NativeAlarm {
            id: self.id,
            label: self.label,
            local_time: self.local_time,
            days_of_week: self.days_of_week,
            enabled: self.enabled,
            sound_id: self.sound_id,
            snooze_minutes: self.snooze_minutes,
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveNativeAlarm {
    pub alarm: NativeAlarm,
    pub occurrence_key: String,
    pub triggered_at_ms: i64,
    pub source: NativeAlarmSource,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeAlarmSource {
    Scheduled,
    Snooze,
    Test,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeAlarmEventKind {
    Triggered,
    Snoozed,
    Dismissed,
    Test,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAlarmNotificationStatus {
    pub ready: bool,
    pub sent: bool,
    /// `granted`, `denied`, `prompt`, `promptWithRationale`, or `unavailable`.
    pub permission: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAlarmAudioStatus {
    pub ready: bool,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAlarmEvent {
    pub kind: NativeAlarmEventKind,
    pub active: ActiveNativeAlarm,
    pub notification: NativeAlarmNotificationStatus,
    pub audio: NativeAlarmAudioStatus,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAlarmSchedulerStatus {
    /// The process deliberately stops scheduling when the app exits or the OS
    /// suspends it; it is not a wake-from-sleep/background alarm service.
    pub app_active_only: bool,
    /// When false, the scheduler still works for this app process but stores
    /// schedules only in memory and reports why they will not survive restart.
    pub persistent_storage_ready: bool,
    pub notification: NativeAlarmNotificationStatus,
    pub audio: NativeAlarmAudioStatus,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAlarmListResponse {
    pub alarms: Vec<NativeAlarm>,
    pub active: Option<ActiveNativeAlarm>,
    pub status: NativeAlarmSchedulerStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAlarmMutationResponse {
    pub alarm: Option<NativeAlarm>,
    pub active: Option<ActiveNativeAlarm>,
    pub status: NativeAlarmSchedulerStatus,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AlarmSchedulerError {
    Validation {
        field: &'static str,
        message: String,
    },
    Storage {
        message: String,
    },
    State {
        message: String,
    },
}

impl fmt::Display for AlarmSchedulerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation { message, .. }
            | Self::Storage { message }
            | Self::State { message } => formatter.write_str(message),
        }
    }
}

impl std::error::Error for AlarmSchedulerError {}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnoozeRecord {
    due_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAlarmState {
    #[serde(default = "default_state_version")]
    version: u8,
    #[serde(default)]
    alarms: Vec<NativeAlarm>,
    #[serde(default)]
    snoozes: BTreeMap<String, SnoozeRecord>,
    /// One compact occurrence key per alarm prevents a one-minute trigger from
    /// being delivered repeatedly as the scheduler polls.
    #[serde(default)]
    last_occurrences: BTreeMap<String, String>,
}

impl Default for PersistedAlarmState {
    fn default() -> Self {
        Self {
            version: ALARM_STATE_VERSION,
            alarms: Vec::new(),
            snoozes: BTreeMap::new(),
            last_occurrences: BTreeMap::new(),
        }
    }
}

struct SchedulerState {
    persisted: PersistedAlarmState,
    /// Due alarms that arrived while another alarm was active. This queue is
    /// deliberately process-local: the scheduler makes only an app-active
    /// guarantee and does not claim restart or wake-from-sleep recovery.
    pending: Vec<ActiveNativeAlarm>,
    active: Option<ActiveNativeAlarm>,
    /// This is process-local by design. It enables bounded recovery from a
    /// delayed worker tick, but resets on restart so the scheduler cannot
    /// present itself as a background or wake-from-sleep service.
    last_schedule_scan: Option<DateTime<Local>>,
    storage_error: Option<String>,
}

struct SchedulerWorker {
    stop: mpsc::Sender<()>,
    join: thread::JoinHandle<()>,
}

/// A managed state object containing only non-secret schedule data.
pub struct NativeAlarmScheduler {
    /// `None` deliberately means degraded, in-memory-only operation. Storage
    /// initialization must never stop the display from starting.
    path: Option<PathBuf>,
    state: Mutex<SchedulerState>,
    worker: Mutex<Option<SchedulerWorker>>,
}

impl NativeAlarmScheduler {
    /// Loads durable state when the app-data directory is usable. If it is
    /// not, retain the exact same scheduler behavior in memory and surface a
    /// truthful `persistentStorageReady: false` status to the UI.
    pub fn load(app: &AppHandle) -> Self {
        let (path, preparation_error) = match app.path().app_local_data_dir() {
            Ok(directory) if fs::create_dir_all(&directory).is_ok() => {
                (Some(directory.join(ALARM_STATE_FILE)), None)
            }
            Ok(_) => (
                None,
                Some(
                    storage_error(
                        "Native alarm storage could not be prepared; schedules are running in memory only and will not survive an app restart.",
                    )
                    .to_string(),
                ),
            ),
            Err(_) => (
                None,
                Some(
                    storage_error(
                        "Native alarm storage is unavailable on this device; schedules are running in memory only and will not survive an app restart.",
                    )
                    .to_string(),
                ),
            ),
        };

        Self::from_storage(path, preparation_error)
    }

    fn from_storage(path: Option<PathBuf>, preparation_error: Option<String>) -> Self {
        let (persisted, loaded_error) = match path.as_deref() {
            Some(path) => load_persisted_state(path),
            None => (PersistedAlarmState::default(), None),
        };

        Self {
            path,
            state: Mutex::new(SchedulerState {
                persisted,
                pending: Vec::new(),
                active: None,
                last_schedule_scan: None,
                storage_error: preparation_error.or(loaded_error),
            }),
            worker: Mutex::new(None),
        }
    }

    pub fn schedule(&self, input: NativeAlarmInput) -> Result<NativeAlarm, AlarmSchedulerError> {
        let alarm = input.into_alarm()?;
        let mut state = self.lock()?;
        let is_new = !state
            .persisted
            .alarms
            .iter()
            .any(|item| item.id == alarm.id);
        if is_new && state.persisted.alarms.len() >= MAX_ALARMS {
            return Err(validation_error(
                "id",
                "Ambient Glass supports at most 128 native alarm schedules.",
            ));
        }

        if let Some(existing) = state
            .persisted
            .alarms
            .iter_mut()
            .find(|item| item.id == alarm.id)
        {
            *existing = alarm.clone();
        } else {
            state.persisted.alarms.push(alarm.clone());
        }
        state.persisted.alarms.sort_by(|left, right| {
            left.local_time
                .cmp(&right.local_time)
                .then_with(|| left.id.cmp(&right.id))
        });
        state.persisted.last_occurrences.remove(&alarm.id);
        state.persisted.snoozes.remove(&alarm.id);
        // A replacement or disable must not leave an older pending version of
        // the same schedule waiting to surface after the current alarm ends.
        state.pending.retain(|pending| pending.alarm.id != alarm.id);
        let disables_active_alarm = !alarm.enabled
            && state
                .active
                .as_ref()
                .is_some_and(|active| active.alarm.id == alarm.id);
        if disables_active_alarm {
            state.active = None;
        }
        self.persist(&mut state);
        Ok(alarm)
    }

    pub fn list(&self, app: &AppHandle) -> NativeAlarmListResponse {
        let (alarms, active, storage_error) = match self.state.lock() {
            Ok(state) => (
                state.persisted.alarms.clone(),
                state.active.clone(),
                state.storage_error.clone(),
            ),
            Err(_) => (
                Vec::new(),
                None,
                Some("Native alarm state is temporarily unavailable.".to_owned()),
            ),
        };
        NativeAlarmListResponse {
            alarms,
            active,
            status: scheduler_status(app, storage_error),
        }
    }

    pub fn status(&self, app: &AppHandle) -> NativeAlarmSchedulerStatus {
        let storage_error = self
            .state
            .lock()
            .ok()
            .and_then(|state| state.storage_error.clone());
        scheduler_status(app, storage_error)
    }

    pub fn active(&self) -> Option<ActiveNativeAlarm> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.active.clone())
    }

    pub fn snooze(
        &self,
        id: &str,
        minutes: Option<u16>,
        now: DateTime<Local>,
    ) -> Result<NativeAlarmEvent, AlarmSchedulerError> {
        let id = normalized_identifier(id)?;
        let mut state = self.lock()?;
        let active = state
            .active
            .take()
            .ok_or_else(|| AlarmSchedulerError::State {
                message: "There is no active native alarm to snooze.".to_owned(),
            })?;
        if active.alarm.id != id {
            state.active = Some(active);
            return Err(AlarmSchedulerError::State {
                message: "That alarm is not the active native alarm.".to_owned(),
            });
        }
        let minutes = minutes.unwrap_or(active.alarm.snooze_minutes);
        validate_snooze_minutes(minutes)?;
        let due_at_ms = now
            .timestamp_millis()
            .saturating_add(i64::from(minutes).saturating_mul(60_000));
        state
            .persisted
            .snoozes
            .insert(id, SnoozeRecord { due_at_ms });
        self.persist(&mut state);

        Ok(new_event(
            NativeAlarmEventKind::Snoozed,
            ActiveNativeAlarm {
                occurrence_key: format!("snooze:{}:{due_at_ms}", active.alarm.id),
                triggered_at_ms: due_at_ms,
                source: NativeAlarmSource::Snooze,
                alarm: active.alarm,
            },
            format!("Alarm snoozed for {minutes} minutes."),
        ))
    }

    pub fn dismiss(&self, id: &str) -> Result<Option<NativeAlarmEvent>, AlarmSchedulerError> {
        let id = normalized_identifier(id)?;
        let mut state = self.lock()?;
        let Some(active) = state.active.take() else {
            return Ok(None);
        };
        if active.alarm.id != id {
            state.active = Some(active);
            return Ok(None);
        }
        Ok(Some(new_event(
            NativeAlarmEventKind::Dismissed,
            active,
            "Native alarm dismissed.",
        )))
    }

    pub fn test(
        &self,
        id: &str,
        now: DateTime<Local>,
    ) -> Result<NativeAlarmEvent, AlarmSchedulerError> {
        let id = normalized_identifier(id)?;
        let mut state = self.lock()?;
        if state.active.is_some() {
            return Err(AlarmSchedulerError::State {
                message: "Dismiss or snooze the active native alarm before running a test."
                    .to_owned(),
            });
        }
        let alarm = state
            .persisted
            .alarms
            .iter()
            .find(|alarm| alarm.id == id)
            .cloned()
            .ok_or_else(|| AlarmSchedulerError::State {
                message: "That native alarm does not exist.".to_owned(),
            })?;
        let active = ActiveNativeAlarm {
            occurrence_key: format!("test:{}:{}", alarm.id, now.timestamp_millis()),
            triggered_at_ms: now.timestamp_millis(),
            source: NativeAlarmSource::Test,
            alarm,
        };
        state.active = Some(active.clone());
        Ok(new_event(
            NativeAlarmEventKind::Test,
            active,
            "Native alarm test requested.",
        ))
    }

    /// Poll once while the host app is alive. A suspended or exited process is
    /// intentionally not treated as a background wake-up service. A short,
    /// bounded in-process delay can recover skipped schedule minutes; longer
    /// gaps inspect only the current minute and never replay stale ones.
    pub fn tick(&self, now: DateTime<Local>) -> Result<Vec<NativeAlarmEvent>, AlarmSchedulerError> {
        let mut state = self.lock()?;
        let previous_schedule_scan = state.last_schedule_scan;
        state.last_schedule_scan = Some(now);
        let snooze_count_before = state.persisted.snoozes.len();
        let due_snoozes = take_due_snoozes(
            &mut state.persisted,
            now.timestamp_millis(),
            previous_schedule_scan.is_some(),
        );
        let snoozed_ids: BTreeSet<String> = due_snoozes
            .iter()
            .map(|active| active.alarm.id.clone())
            .collect();
        let due_schedules = take_due_schedules(
            &mut state.persisted,
            previous_schedule_scan,
            now,
            &snoozed_ids,
        );
        let persisted_changed =
            state.persisted.snoozes.len() != snooze_count_before || !due_schedules.is_empty();

        // Keep every simultaneous due alarm in a stable, in-memory order. The
        // first becomes active now; the rest activate on the next poll after
        // snooze/dismiss. This avoids silently losing a second alarm merely
        // because the first one remained visible through the scheduled minute.
        for active in due_snoozes.into_iter().chain(due_schedules) {
            if !state
                .pending
                .iter()
                .any(|pending| pending.occurrence_key == active.occurrence_key)
            {
                state.pending.push(active);
            }
        }
        state.pending.sort_by(|left, right| {
            left.triggered_at_ms
                .cmp(&right.triggered_at_ms)
                .then_with(|| left.alarm.id.cmp(&right.alarm.id))
                .then_with(|| left.occurrence_key.cmp(&right.occurrence_key))
        });

        let mut events = Vec::new();
        let activated = if state.active.is_none() && !state.pending.is_empty() {
            Some(state.pending.remove(0))
        } else {
            None
        };
        if let Some(active) = activated {
            let message = match active.source {
                NativeAlarmSource::Snooze => "Native snoozed alarm is due.",
                NativeAlarmSource::Scheduled => "Native scheduled alarm is due.",
                NativeAlarmSource::Test => "Native test alarm is due.",
            };
            state.active = Some(active.clone());
            events.push(new_event(NativeAlarmEventKind::Triggered, active, message));
        }

        // A disabled/removed alarm can leave an obsolete snooze behind. Persist
        // that removal even if another alarm is currently active; otherwise it
        // would be scanned and discarded again on every poll.
        if persisted_changed {
            self.persist(&mut state);
        }

        Ok(events)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, SchedulerState>, AlarmSchedulerError> {
        self.state.lock().map_err(|_| AlarmSchedulerError::State {
            message: "Native alarm state is temporarily unavailable.".to_owned(),
        })
    }

    fn persist(&self, state: &mut SchedulerState) {
        let Some(path) = self.path.as_deref() else {
            state.storage_error.get_or_insert_with(|| {
                storage_error(
                    "Native alarm storage is unavailable; schedules are running in memory only and will not survive an app restart.",
                )
                .to_string()
            });
            return;
        };
        let bytes = match serde_json::to_vec_pretty(&state.persisted) {
            Ok(bytes) => bytes,
            Err(_) => {
                let error = storage_error("Native alarm state could not be serialized.");
                state.storage_error = Some(error.to_string());
                return;
            }
        };
        if let Some(parent) = path.parent() {
            if fs::create_dir_all(parent).is_err() {
                let error = storage_error(
                    "Native alarm storage could not be prepared; schedules remain in memory only until storage is available again.",
                );
                state.storage_error = Some(error.to_string());
                return;
            }
        }
        let backup = backup_path(path);
        if path.exists() {
            let _ = fs::copy(path, &backup);
        }
        if fs::write(path, bytes).is_err() {
            let error = storage_error(
                "Native alarm state could not be saved; schedules remain in memory only until storage is available again.",
            );
            state.storage_error = Some(error.to_string());
            return;
        }
        state.storage_error = None;
    }

    fn start(&self, app: AppHandle) -> Result<(), AlarmSchedulerError> {
        let mut worker = self.worker.lock().map_err(|_| AlarmSchedulerError::State {
            message: "Native alarm scheduler lifecycle is temporarily unavailable.".to_owned(),
        })?;
        if worker.is_some() {
            return Ok(());
        }

        let (stop, stop_signal) = mpsc::channel();
        let join = thread::Builder::new()
            .name("ambient-glass-alarms".to_owned())
            .spawn(move || loop {
                match stop_signal.recv_timeout(Duration::from_secs(1)) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        let scheduler = app.state::<NativeAlarmScheduler>();
                        if let Ok(events) = scheduler.tick(Local::now()) {
                            for event in events {
                                let _ = emit_alarm_event(&app, event);
                            }
                        }
                    }
                }
            })
            .map_err(|_| AlarmSchedulerError::State {
                message: "Native alarm scheduling could not be started.".to_owned(),
            })?;
        *worker = Some(SchedulerWorker { stop, join });
        Ok(())
    }

    /// Sends the worker a stop signal and joins it before application teardown.
    /// This is idempotent and avoids leaving an app-handle-owning thread alive
    /// after the Tauri event loop exits.
    pub fn stop(&self) {
        let worker = match self.worker.lock() {
            Ok(mut worker) => worker.take(),
            Err(_) => None,
        };
        if let Some(worker) = worker {
            let _ = worker.stop.send(());
            let _ = worker.join.join();
        }
    }
}

impl Drop for NativeAlarmScheduler {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Starts one low-frequency app-process poller. It has no external process,
/// service registration, or wake-from-sleep behavior.
pub fn start_native_alarm_scheduler(app: AppHandle) -> Result<(), AlarmSchedulerError> {
    app.clone().state::<NativeAlarmScheduler>().start(app)
}

/// Stops and joins the app-process alarm worker. Calling this from Tauri's
/// exit event keeps the scheduler explicitly app-active only.
pub fn stop_native_alarm_scheduler(app: &AppHandle) {
    app.state::<NativeAlarmScheduler>().stop();
}

/// Sends the browser-consumable event and a best-effort native notification for
/// trigger/test events. The scheduler accepts no custom sound path or arbitrary
/// local file; the frontend owns the one bundled local chime it can play.
pub fn emit_alarm_event(app: &AppHandle, mut event: NativeAlarmEvent) -> NativeAlarmEvent {
    if matches!(
        event.kind,
        NativeAlarmEventKind::Triggered | NativeAlarmEventKind::Test
    ) {
        event.notification = send_alarm_notification(app, &event.active.alarm);
    }
    let _ = app.emit(ALARM_EVENT, event.clone());
    event
}

fn take_due_snoozes(
    state: &mut PersistedAlarmState,
    now_ms: i64,
    recover_in_process: bool,
) -> Vec<ActiveNativeAlarm> {
    let oldest_recoverable_due_at_ms = now_ms.saturating_sub(ACTIVE_APP_ALARM_RECOVERY_MILLIS);
    let mut due = state
        .snoozes
        .iter()
        .filter(|(_, snooze)| snooze.due_at_ms <= now_ms)
        .map(|(id, snooze)| (id.clone(), snooze.due_at_ms))
        .collect::<Vec<_>>();
    due.sort_by(|(left_id, left_due_at_ms), (right_id, right_due_at_ms)| {
        left_due_at_ms
            .cmp(right_due_at_ms)
            .then_with(|| left_id.cmp(right_id))
    });

    due.into_iter()
        .filter_map(|(id, due_at_ms)| {
            // Remove invalid/disabled and valid due records alike so a stale
            // persisted snooze can never emit repeatedly on future polls. A
            // stale snooze is also not replayed after a long suspend or app
            // restart: recovery requires a prior in-process scan and this
            // process never claims wake-from-sleep behavior.
            state.snoozes.remove(&id)?;
            let alarm = state.alarms.iter().find(|alarm| alarm.id == id)?.clone();
            (recover_in_process && alarm.enabled && due_at_ms >= oldest_recoverable_due_at_ms)
                .then_some(ActiveNativeAlarm {
                    occurrence_key: format!("snooze:{}:{due_at_ms}", alarm.id),
                    triggered_at_ms: now_ms,
                    source: NativeAlarmSource::Snooze,
                    alarm,
                })
        })
        .collect()
}

fn take_due_schedules(
    state: &mut PersistedAlarmState,
    previous_scan: Option<DateTime<Local>>,
    now: DateTime<Local>,
    snoozed_ids: &BTreeSet<String>,
) -> Vec<ActiveNativeAlarm> {
    let mut due = Vec::new();
    for scheduled_at in schedule_scan_minutes(previous_scan, now) {
        let day = scheduled_at.weekday().num_days_from_sunday() as u8;
        let scheduled_time = format!("{:02}:{:02}", scheduled_at.hour(), scheduled_at.minute());
        // Clone this small bounded collection so recording due occurrences can
        // never overlap an immutable borrow of the persisted alarm vector.
        for alarm in state.alarms.clone().into_iter().filter(|alarm| {
            alarm.enabled
                && !snoozed_ids.contains(&alarm.id)
                && alarm.local_time == scheduled_time
                && (alarm.days_of_week.is_empty() || alarm.days_of_week.contains(&day))
        }) {
            let occurrence_key = format!(
                "{}:{}:{}",
                alarm.id,
                scheduled_at.format("%Y-%m-%d"),
                alarm.local_time
            );
            if state.last_occurrences.get(&alarm.id) == Some(&occurrence_key) {
                continue;
            }
            state
                .last_occurrences
                .insert(alarm.id.clone(), occurrence_key.clone());
            due.push(ActiveNativeAlarm {
                alarm,
                occurrence_key,
                triggered_at_ms: scheduled_at.timestamp_millis(),
                source: NativeAlarmSource::Scheduled,
            });
        }
    }
    due
}

/// Produces only a bounded set of local minute slots for a live worker.
///
/// A missing prior scan means process startup, so inspect the current minute
/// only. Likewise, a clock rollback or a gap beyond the short threshold does
/// not replay history: it scans the current minute and makes no claim to have
/// recovered alarms while the app was suspended or not running.
fn schedule_scan_minutes(
    previous_scan: Option<DateTime<Local>>,
    now: DateTime<Local>,
) -> Vec<DateTime<Local>> {
    let current_minute = minute_start(now);
    let Some(previous_scan) = previous_scan else {
        return vec![current_minute];
    };
    let elapsed = now.signed_duration_since(previous_scan);
    if elapsed < ChronoDuration::zero()
        || elapsed > ChronoDuration::minutes(ACTIVE_APP_ALARM_RECOVERY_MINUTES)
    {
        return vec![current_minute];
    }

    let mut scan_minute = minute_start(previous_scan);
    let mut minutes = Vec::new();
    while scan_minute <= current_minute {
        minutes.push(scan_minute);
        scan_minute += ChronoDuration::minutes(1);
    }
    minutes
}

fn minute_start(value: DateTime<Local>) -> DateTime<Local> {
    let seconds = value.second();
    let nanoseconds = value.nanosecond();
    value
        - ChronoDuration::seconds(i64::from(seconds))
        - ChronoDuration::nanoseconds(i64::from(nanoseconds))
}

fn new_event(
    kind: NativeAlarmEventKind,
    active: ActiveNativeAlarm,
    message: impl Into<String>,
) -> NativeAlarmEvent {
    NativeAlarmEvent {
        kind,
        active,
        notification: NativeAlarmNotificationStatus {
            ready: false,
            sent: false,
            permission: "unchecked".to_owned(),
            message: "Native notification status has not been checked yet.".to_owned(),
        },
        audio: native_audio_status(),
        message: message.into(),
    }
}

fn scheduler_status(app: &AppHandle, storage_error: Option<String>) -> NativeAlarmSchedulerStatus {
    let persistent_storage_ready = storage_error.is_none();
    let message = match storage_error {
        Some(error) => error,
        None => format!(
            "Native alarm schedules are active while Ambient Glass is running. Short in-process delays recover up to {ACTIVE_APP_ALARM_RECOVERY_MINUTES} minutes; this does not wake a sleeping computer or replay missed alarms after restart."
        ),
    };
    NativeAlarmSchedulerStatus {
        app_active_only: true,
        persistent_storage_ready,
        notification: notification_status(app),
        audio: native_audio_status(),
        message,
    }
}

fn native_audio_status() -> NativeAlarmAudioStatus {
    NativeAlarmAudioStatus {
        ready: false,
        message: "The native scheduler has no independent audio service; the active webview plays its bundled local chime."
            .to_owned(),
    }
}

fn notification_status(app: &AppHandle) -> NativeAlarmNotificationStatus {
    match app.notification().permission_state() {
        Ok(PermissionState::Granted) => NativeAlarmNotificationStatus {
            ready: true,
            sent: false,
            permission: "granted".to_owned(),
            message: "Native notifications are permitted for app-active alarms.".to_owned(),
        },
        Ok(PermissionState::Denied) => NativeAlarmNotificationStatus {
            ready: false,
            sent: false,
            permission: "denied".to_owned(),
            message: "Native notifications are denied; the Tauri event remains available."
                .to_owned(),
        },
        Ok(PermissionState::Prompt) => NativeAlarmNotificationStatus {
            ready: false,
            sent: false,
            permission: "prompt".to_owned(),
            message: "Native notification permission has not been granted yet.".to_owned(),
        },
        Ok(PermissionState::PromptWithRationale) => NativeAlarmNotificationStatus {
            ready: false,
            sent: false,
            permission: "promptWithRationale".to_owned(),
            message: "Native notification permission needs a user-facing rationale.".to_owned(),
        },
        Err(_) => NativeAlarmNotificationStatus {
            ready: false,
            sent: false,
            permission: "unavailable".to_owned(),
            message:
                "Native notification status is unavailable; the Tauri event remains available."
                    .to_owned(),
        },
    }
}

fn send_alarm_notification(app: &AppHandle, alarm: &NativeAlarm) -> NativeAlarmNotificationStatus {
    let mut status = notification_status(app);
    if !status.ready {
        return status;
    }
    let sent = app
        .notification()
        .builder()
        .title("Ambient Glass alarm")
        .body(alarm.label.clone())
        .show()
        .is_ok();
    status.sent = sent;
    status.message = if sent {
        "Native alarm notification sent without a custom audio asset.".to_owned()
    } else {
        "Native notification could not be sent; the Tauri event remains available.".to_owned()
    };
    status
}

fn load_persisted_state(path: &Path) -> (PersistedAlarmState, Option<String>) {
    for candidate in [path.to_path_buf(), backup_path(path)] {
        match fs::read(&candidate) {
            Ok(bytes) => match serde_json::from_slice::<PersistedAlarmState>(&bytes) {
                Ok(mut state) if state.version == ALARM_STATE_VERSION => {
                    let removed = sanitize_persisted_state(&mut state);
                    let message = if removed {
                        Some("Invalid persisted native alarm entries were discarded.".to_owned())
                    } else if candidate != path {
                        Some("Native alarm state was recovered from its backup.".to_owned())
                    } else {
                        None
                    };
                    return (state, message);
                }
                _ => continue,
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => continue,
        }
    }
    (
        PersistedAlarmState::default(),
        if path.exists() {
            Some("Native alarm state could not be read; a clean schedule was started.".to_owned())
        } else {
            None
        },
    )
}

fn sanitize_persisted_state(state: &mut PersistedAlarmState) -> bool {
    let alarm_count_before = state.alarms.len();
    let snooze_count_before = state.snoozes.len();
    let occurrence_count_before = state.last_occurrences.len();
    state.alarms.retain(validate_persisted_alarm);
    state.alarms.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then_with(|| left.local_time.cmp(&right.local_time))
            .then_with(|| left.label.cmp(&right.label))
    });
    let mut seen_ids = BTreeSet::new();
    state
        .alarms
        .retain(|alarm| seen_ids.insert(alarm.id.clone()));
    let valid_ids: BTreeSet<String> = state.alarms.iter().map(|alarm| alarm.id.clone()).collect();
    state.snoozes.retain(|id, _| valid_ids.contains(id));
    state
        .last_occurrences
        .retain(|id, _| valid_ids.contains(id));
    alarm_count_before != state.alarms.len()
        || snooze_count_before != state.snoozes.len()
        || occurrence_count_before != state.last_occurrences.len()
}

fn validate_persisted_alarm(alarm: &NativeAlarm) -> bool {
    normalized_identifier(&alarm.id).is_ok()
        && normalized_label(&alarm.label).is_ok()
        && validate_local_time(&alarm.local_time).is_ok()
        && alarm.days_of_week.iter().all(|day| *day <= 6)
        && normalized_sound_id(&alarm.sound_id).is_ok()
        && validate_snooze_minutes(alarm.snooze_minutes).is_ok()
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn default_enabled() -> bool {
    true
}

fn default_sound_id() -> String {
    "browser-fallback".to_owned()
}

fn default_snooze_minutes() -> u16 {
    10
}

fn default_state_version() -> u8 {
    ALARM_STATE_VERSION
}

fn normalized_identifier(value: &str) -> Result<String, AlarmSchedulerError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > MAX_ID_CHARS {
        return Err(validation_error(
            "id",
            "Alarm ids must contain 1 through 96 characters.",
        ));
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(validation_error(
            "id",
            "Alarm ids may contain only letters, numbers, hyphens, and underscores.",
        ));
    }
    Ok(value.to_owned())
}

fn normalized_label(value: &str) -> Result<String, AlarmSchedulerError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > MAX_LABEL_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(validation_error(
            "label",
            "Alarm labels must contain 1 through 120 printable characters.",
        ));
    }
    Ok(value.to_owned())
}

fn normalized_sound_id(value: &str) -> Result<String, AlarmSchedulerError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > MAX_SOUND_ID_CHARS {
        return Err(validation_error(
            "soundId",
            "Alarm sound ids must contain 1 through 64 characters.",
        ));
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(validation_error(
            "soundId",
            "Alarm sound ids may contain only letters, numbers, hyphens, and underscores.",
        ));
    }
    Ok(value.to_owned())
}

fn validate_local_time(value: &str) -> Result<(), AlarmSchedulerError> {
    let bytes = value.as_bytes();
    let valid_shape = bytes.len() == 5
        && bytes[2] == b':'
        && [0, 1, 3, 4]
            .iter()
            .all(|index| bytes[*index].is_ascii_digit());
    if !valid_shape {
        return Err(validation_error(
            "localTime",
            "Use a local alarm time in HH:MM form.",
        ));
    }
    let hour = (bytes[0] - b'0') * 10 + (bytes[1] - b'0');
    let minute = (bytes[3] - b'0') * 10 + (bytes[4] - b'0');
    if hour > 23 || minute > 59 {
        return Err(validation_error(
            "localTime",
            "Use a local alarm time in HH:MM form.",
        ));
    }
    Ok(())
}

fn validate_snooze_minutes(minutes: u16) -> Result<(), AlarmSchedulerError> {
    if !(MIN_SNOOZE_MINUTES..=MAX_SNOOZE_MINUTES).contains(&minutes) {
        return Err(validation_error(
            "snoozeMinutes",
            "Alarm snooze duration must be from 1 through 240 minutes.",
        ));
    }
    Ok(())
}

fn validation_error(field: &'static str, message: &'static str) -> AlarmSchedulerError {
    AlarmSchedulerError::Validation {
        field,
        message: message.to_owned(),
    }
}

fn storage_error(message: &'static str) -> AlarmSchedulerError {
    AlarmSchedulerError::Storage {
        message: message.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{BTreeMap, BTreeSet},
        sync::mpsc,
        thread,
    };

    use chrono::{Datelike, Duration, Local, TimeZone};

    use super::{
        take_due_schedules, take_due_snoozes, validate_local_time, NativeAlarm, NativeAlarmInput,
        NativeAlarmScheduler, PersistedAlarmState, SchedulerWorker, SnoozeRecord,
    };

    #[test]
    fn schedule_input_normalizes_days_and_rejects_invalid_times() {
        let alarm = NativeAlarmInput {
            id: "weekday-alarm".to_owned(),
            label: "Morning briefing".to_owned(),
            local_time: "07:30".to_owned(),
            days_of_week: vec![5, 1, 1],
            enabled: true,
            sound_id: "browser-fallback".to_owned(),
            snooze_minutes: 10,
        }
        .into_alarm()
        .expect("valid alarm");
        assert_eq!(alarm.days_of_week, vec![1, 5]);
        assert!(validate_local_time("24:00").is_err());
        assert!(validate_local_time("7:30").is_err());
    }

    #[test]
    fn a_scheduled_minute_emits_once_until_the_next_occurrence() {
        let now = Local
            .with_ymd_and_hms(2026, 5, 11, 7, 30, 15)
            .single()
            .expect("unambiguous local test time");
        let weekday = now.weekday().num_days_from_sunday() as u8;
        let mut state = PersistedAlarmState {
            alarms: vec![NativeAlarm {
                id: "morning".to_owned(),
                label: "Morning briefing".to_owned(),
                local_time: "07:30".to_owned(),
                days_of_week: vec![weekday],
                enabled: true,
                sound_id: "browser-fallback".to_owned(),
                snooze_minutes: 10,
            }],
            snoozes: BTreeMap::new(),
            last_occurrences: BTreeMap::new(),
            version: 1,
        };

        let first = take_due_schedules(&mut state, None, now, &BTreeSet::new());
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].alarm.id, "morning");
        assert!(take_due_schedules(&mut state, Some(now), now, &BTreeSet::new()).is_empty());
    }

    #[test]
    fn simultaneous_schedules_are_collected_in_stable_stored_order() {
        let now = Local
            .with_ymd_and_hms(2026, 5, 11, 7, 30, 15)
            .single()
            .expect("unambiguous local test time");
        let weekday = now.weekday().num_days_from_sunday() as u8;
        let schedule = |id: &str| NativeAlarm {
            id: id.to_owned(),
            label: id.to_owned(),
            local_time: "07:30".to_owned(),
            days_of_week: vec![weekday],
            enabled: true,
            sound_id: "browser-fallback".to_owned(),
            snooze_minutes: 10,
        };
        let mut state = PersistedAlarmState {
            alarms: vec![schedule("alpha"), schedule("zeta")],
            snoozes: BTreeMap::new(),
            last_occurrences: BTreeMap::new(),
            version: 1,
        };

        let due = take_due_schedules(&mut state, None, now, &BTreeSet::new());
        assert_eq!(
            due.iter()
                .map(|active| active.alarm.id.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "zeta"],
        );
    }

    #[test]
    fn short_in_process_delay_recovers_the_skipped_minute_only_once() {
        let before_delay = Local
            .with_ymd_and_hms(2026, 5, 11, 7, 30, 20)
            .single()
            .expect("unambiguous local test time");
        let after_delay = Local
            .with_ymd_and_hms(2026, 5, 11, 7, 31, 35)
            .single()
            .expect("unambiguous local test time");
        let weekday = after_delay.weekday().num_days_from_sunday() as u8;
        let mut state = PersistedAlarmState {
            alarms: vec![NativeAlarm {
                id: "briefing".to_owned(),
                label: "Briefing".to_owned(),
                local_time: "07:31".to_owned(),
                days_of_week: vec![weekday],
                enabled: true,
                sound_id: "browser-fallback".to_owned(),
                snooze_minutes: 10,
            }],
            snoozes: BTreeMap::new(),
            last_occurrences: BTreeMap::new(),
            version: 1,
        };

        let recovered = take_due_schedules(
            &mut state,
            Some(before_delay),
            after_delay,
            &BTreeSet::new(),
        );
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].occurrence_key, "briefing:2026-05-11:07:31");
        assert_eq!(
            recovered[0].triggered_at_ms,
            Local
                .with_ymd_and_hms(2026, 5, 11, 7, 31, 0)
                .single()
                .expect("unambiguous local test time")
                .timestamp_millis(),
        );

        assert!(take_due_schedules(
            &mut state,
            Some(after_delay),
            after_delay + Duration::seconds(20),
            &BTreeSet::new(),
        )
        .is_empty());
    }

    #[test]
    fn long_gap_scans_only_the_current_minute_without_replaying_stale_alarms() {
        let before_gap = Local
            .with_ymd_and_hms(2026, 5, 11, 7, 30, 0)
            .single()
            .expect("unambiguous local test time");
        let after_gap = Local
            .with_ymd_and_hms(2026, 5, 11, 7, 46, 10)
            .single()
            .expect("unambiguous local test time");
        let weekday = after_gap.weekday().num_days_from_sunday() as u8;
        let schedule = |id: &str, local_time: &str| NativeAlarm {
            id: id.to_owned(),
            label: id.to_owned(),
            local_time: local_time.to_owned(),
            days_of_week: vec![weekday],
            enabled: true,
            sound_id: "browser-fallback".to_owned(),
            snooze_minutes: 10,
        };
        let mut state = PersistedAlarmState {
            alarms: vec![schedule("stale", "07:31"), schedule("current", "07:46")],
            snoozes: BTreeMap::new(),
            last_occurrences: BTreeMap::new(),
            version: 1,
        };

        let due = take_due_schedules(&mut state, Some(before_gap), after_gap, &BTreeSet::new());
        assert_eq!(
            due.iter()
                .map(|active| active.alarm.id.as_str())
                .collect::<Vec<_>>(),
            vec!["current"],
        );
    }

    #[test]
    fn stale_snooze_is_dropped_instead_of_replaying_after_the_recovery_window() {
        let now = Local
            .with_ymd_and_hms(2026, 5, 11, 7, 46, 10)
            .single()
            .expect("unambiguous local test time");
        let mut state = PersistedAlarmState {
            alarms: vec![NativeAlarm {
                id: "morning".to_owned(),
                label: "Morning briefing".to_owned(),
                local_time: "07:30".to_owned(),
                days_of_week: vec![],
                enabled: true,
                sound_id: "browser-fallback".to_owned(),
                snooze_minutes: 10,
            }],
            snoozes: BTreeMap::from([(
                "morning".to_owned(),
                SnoozeRecord {
                    due_at_ms: (now - Duration::minutes(16)).timestamp_millis(),
                },
            )]),
            last_occurrences: BTreeMap::new(),
            version: 1,
        };

        assert!(take_due_snoozes(&mut state, now.timestamp_millis(), true).is_empty());
        assert!(state.snoozes.is_empty());
    }

    #[test]
    fn due_snooze_is_discarded_on_the_first_process_scan_after_restart() {
        let now = Local
            .with_ymd_and_hms(2026, 5, 11, 7, 46, 10)
            .single()
            .expect("unambiguous local test time");
        let mut state = PersistedAlarmState {
            alarms: vec![NativeAlarm {
                id: "morning".to_owned(),
                label: "Morning briefing".to_owned(),
                local_time: "07:30".to_owned(),
                days_of_week: vec![],
                enabled: true,
                sound_id: "browser-fallback".to_owned(),
                snooze_minutes: 10,
            }],
            snoozes: BTreeMap::from([(
                "morning".to_owned(),
                SnoozeRecord {
                    due_at_ms: (now - Duration::minutes(1)).timestamp_millis(),
                },
            )]),
            last_occurrences: BTreeMap::new(),
            version: 1,
        };

        assert!(take_due_snoozes(&mut state, now.timestamp_millis(), false).is_empty());
        assert!(state.snoozes.is_empty());
    }

    #[test]
    fn unavailable_storage_keeps_schedules_in_memory_with_an_explicit_error() {
        let scheduler = NativeAlarmScheduler::from_storage(
            None,
            Some(
                "Native alarm storage is unavailable; schedules are running in memory only and will not survive an app restart."
                    .to_owned(),
            ),
        );
        let alarm = scheduler
            .schedule(NativeAlarmInput {
                id: "memory-only".to_owned(),
                label: "Memory only".to_owned(),
                local_time: "07:30".to_owned(),
                days_of_week: vec![],
                enabled: true,
                sound_id: "browser-fallback".to_owned(),
                snooze_minutes: 10,
            })
            .expect("in-memory scheduling remains available");
        let state = scheduler.lock().expect("available scheduler state");
        assert_eq!(state.persisted.alarms.len(), 1);
        assert_eq!(state.persisted.alarms[0].id, alarm.id);
        assert!(state
            .storage_error
            .as_deref()
            .is_some_and(|message| message.contains("memory only")));
    }

    #[test]
    fn stop_joins_an_alarm_worker_and_is_idempotent() {
        let scheduler = NativeAlarmScheduler::from_storage(None, None);
        let (stop, stop_signal) = mpsc::channel();
        let join = thread::spawn(move || {
            let _ = stop_signal.recv();
        });
        *scheduler.worker.lock().expect("worker lock") = Some(SchedulerWorker { stop, join });

        scheduler.stop();
        scheduler.stop();
        assert!(scheduler.worker.lock().expect("worker lock").is_none());
    }
}
